/**
 * The operations that can lose data or send mail. Registered only in `admin`
 * mode, and each one demands a confirmation phrase naming its exact target.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { confirmPhrase } from '../config.js'
import { csvRowToLead, parseCSV, rowsToObjects } from '../csv.js'
import { displayName, fmtMoney, ticketValue } from '../domain.js'
import { WORKSPACE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, json, safeText, table, text } from '../format.js'
import { deleteLead, getLead, importLeads, invokeReminders, reapplyBatch } from '../repo.js'
import { guardWrite, requireConfirmation, workspace } from './common.js'

const MAX_CSV_BYTES = 25 * 1024 * 1024

export function registerAdmin(server: McpServer): void {
  // ── delete ────────────────────────────────────────────────────────────────
  server.registerTool(
    'leads_delete',
    {
      title: 'Delete a lead',
      description: `Permanently delete one lead and everything attached to it — its follow-up sequence and all five weeks of steps go with it. There is no undo.

Deliberately one lead per call and confirmation-gated: call it once without \`confirm\` to see exactly what would go, then repeat the call with the confirmation phrase the first call returns.

Only do this when the person has asked for this specific lead to be deleted. To take a lead out of the pipeline instead, move it to the lost stage with leads_update.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        record_id: z.string().min(1).max(200).describe('The lead to delete.'),
        confirm: z.string().max(300).optional()
          .describe('The confirmation phrase returned by the unconfirmed call, e.g. "DELETE abc123".'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_delete', action: a.confirm ? 'delete' : 'delete-preview', workspace: a.workspace, targets: [a.record_id] }),
      async (a) => {
        const { ctx } = await workspace(a.workspace)
        const lead = await getLead(a.record_id)
        if (!lead) throw new Error(`No lead with record_id "${a.record_id}" — nothing to delete.`)
        const phrase = confirmPhrase('DELETE', a.record_id)
        const who = safeText(displayName(lead), 120)

        if (!a.confirm) {
          const preview = {
            ok: false, requires_confirmation: true, confirm: phrase,
            record_id: a.record_id, name: who, workspace: lead.project_id,
            stage: lead.stage, ticket: ticketValue(lead),
          }
          if (a.response_format === ResponseFormat.JSON) return json(preview)
          return text([
            `**Not deleted yet.** This would permanently remove:`,
            '',
            `- **${who}**${lead.practice ? ` — ${safeText(lead.practice, 80)}` : ''} (\`${a.record_id}\`)`,
            `- Workspace ${lead.project_id} · stage ${lead.stage} · ${fmtMoney(ticketValue(lead))}/mo`,
            `- Its follow-up sequence and all five weeks of steps, if it has one.`,
            '',
            `To go ahead, call leads_delete again with confirm="${phrase}".`,
          ].join('\n'))
        }

        requireConfirmation(a.confirm, phrase)
        await deleteLead(a.record_id)
        const payload = { ok: true, deleted: a.record_id, name: who, revenue_removed: Math.round((ticketValue(lead) ?? 0) * ctx.chargePct / 100) }
        if (a.response_format === ResponseFormat.JSON) return json(payload)
        return text(`Deleted **${who}** (\`${a.record_id}\`) and any follow-up sequence attached to it. This cannot be undone.`)
      },
    ),
  )

  // ── import ────────────────────────────────────────────────────────────────
  server.registerTool(
    'leads_import',
    {
      title: 'Import or re-apply a CRM export',
      description: `Load a Zoho CRM CSV export into a workspace, or re-apply a previous import.

Upserts by Record Id: existing leads have their CRM columns refreshed, new ones are inserted. Enrichment entered in the tool — ticket override, notes, charge %, revenue month, source tracking — is read back and re-written unchanged, so an import can never wipe it.

\`action="preview"\` parses the file and reports what would happen without writing. \`action="import"\` needs the confirmation phrase preview returns. \`action="reapply"\` re-runs a stored batch by its id (leads_activity lists them).

The file is read from this machine's filesystem, so give an absolute path.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        action: z.enum(['preview', 'import', 'reapply']).default('preview').describe('What to do.'),
        file: z.string().max(4096).optional().describe('Absolute path to the CSV, for "preview" and "import".'),
        batch_id: z.string().max(100).optional().describe('Import batch to re-apply, for "reapply".'),
        confirm: z.string().max(300).optional().describe('Confirmation phrase from the preview call.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_import', action: a.action, workspace: a.workspace, targets: a.batch_id ? [a.batch_id] : undefined }),
      async (a) => {
        const { project } = await workspace(a.workspace)

        if (a.action === 'reapply') {
          if (!a.batch_id) throw new Error('action "reapply" needs batch_id. leads_activity lists them.')
          const phrase = confirmPhrase('REAPPLY', a.batch_id)
          requireConfirmation(a.confirm, phrase)
          const r = await reapplyBatch(a.batch_id)
          const payload = { ok: true, ...r }
          if (a.response_format === ResponseFormat.JSON) return json(payload)
          return text(`Re-applied "${safeText(r.fileName, 80)}" into ${r.projectId}: ${r.total} row(s), ${r.inserted} new, ${r.updated} refreshed.`)
        }

        if (!a.file) throw new Error(`action "${a.action}" needs file — an absolute path to the CSV.`)
        const path = resolve(a.file)
        let size: number
        try {
          const st = statSync(path)
          if (!st.isFile()) throw new Error('not a regular file')
          size = st.size
        } catch {
          throw new Error(`Cannot read "${path}". Give an absolute path to a CSV file on this machine.`)
        }
        if (size > MAX_CSV_BYTES) {
          throw new Error(`"${path}" is ${(size / 1048576).toFixed(1)} MB, over the ${MAX_CSV_BYTES / 1048576} MB limit.`)
        }

        const objects = rowsToObjects(parseCSV(readFileSync(path, 'utf8')))
        if (!objects.length) throw new Error(`"${path}" has no data rows.`)
        if (!('Record Id' in objects[0])) {
          // Naming the headers found, not the data, keeps a mis-pointed path
          // from turning this tool into a way to read a file's contents back.
          throw new Error(
            `"${path}" has no "Record Id" column, so it is not a Zoho lead export. ` +
            `Columns found: ${Object.keys(objects[0]).slice(0, 12).join(', ')}.`,
          )
        }

        const rows = objects.map((row) => csvRowToLead(row, project)).filter((r) => r.record_id)

        if (!rows.length) throw new Error(`No row in "${path}" has a Record Id.`)

        const byStage = new Map<string, number>()
        for (const r of rows) {
          const stage = String(r.stage)
          byStage.set(stage, (byStage.get(stage) ?? 0) + 1)
        }
        const phrase = confirmPhrase('IMPORT', `${rows.length}:${project.id}`)

        if (a.action === 'preview') {
          const payload = {
            ok: false, requires_confirmation: true, confirm: phrase,
            file: path, workspace: project.id, rows: rows.length,
            by_stage: Object.fromEntries(byStage),
            sample: rows.slice(0, 3).map((r) => ({
              record_id: String(r.record_id),
              name: safeText(r.lead_name as string | null, 80),
              status: String(r.status ?? ''),
              stage: String(r.stage),
            })),
          }
          if (a.response_format === ResponseFormat.JSON) return json(payload)
          return text([
            `**Nothing written yet.** Parsed ${rows.length} row(s) from \`${path}\` for **${project.name}**.`,
            '',
            table(['Stage', 'Rows'], [...byStage.entries()].map(([s, n]) => [s, n]), ['l', 'r']),
            '',
            'Existing leads will have their CRM columns refreshed; notes, ticket overrides, charge % and source tracking are preserved.',
            '',
            `To go ahead, call leads_import again with action="import" and confirm="${phrase}".`,
          ].join('\n'))
        }

        requireConfirmation(a.confirm, phrase)
        const result = await importLeads(rows, path.split(/[\\/]/).pop() ?? 'import.csv', project.id)
        const payload = { ok: true, workspace: project.id, ...result }
        if (a.response_format === ResponseFormat.JSON) return json(payload)
        return text(`Imported into **${project.name}**: ${result.total} row(s) — ${result.inserted} new, ${result.updated} refreshed. Manual enrichment preserved.`)
      },
    ),
  )

  // ── reminders ─────────────────────────────────────────────────────────────
  server.registerTool(
    'leads_run_reminders',
    {
      title: 'Run or test the reminder job',
      description: `Drive the follow-up reminder Edge Function, which emails the lead manager the leads owed a follow-up.

Modes:
  - "ping" — prove the function is deployed, reachable and sees its SMTP configuration. Sends nothing. Start here when email is not working.
  - "dry" — report exactly what today's run would send, to whom, without sending.
  - "test" — send one sample digest to \`to\`, to prove SMTP works end to end.
  - "send" — run today's digest for real. Needs confirmation, because it puts mail in someone's inbox.

Everything runs as the signed-in tracker user, so no shared cron secret is involved.`,
      inputSchema: z.strictObject({
        mode: z.enum(['ping', 'dry', 'test', 'send']).default('ping').describe('What to do.'),
        to: z.string().max(200).optional().describe('Recipient for mode "test".'),
        confirm: z.string().max(300).optional().describe('Confirmation phrase, required for mode "send".'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_run_reminders', action: a.mode }),
      async (a) => {
        if (a.mode === 'send') {
          const phrase = confirmPhrase('SEND', 'reminders')
          if (!a.confirm) {
            const preview = await invokeReminders({ dry: true })
            const lines = [
              '**Nothing sent yet.** A real run would do this:',
              '',
              `- Digests to: ${preview.digestsSent?.length ? preview.digestsSent.join(', ') : 'nobody'}`,
              `- Managers prompted about finished sequences: ${preview.prompted ?? 0}`,
              `- Leads auto-marked lost: ${preview.autoLost ?? 0}`,
              '',
              `To send for real, call again with confirm="${phrase}".`,
            ]
            if (a.response_format === ResponseFormat.JSON) {
              return json({ ok: false, requires_confirmation: true, confirm: phrase, would: preview })
            }
            return text(lines.join('\n'))
          }
          requireConfirmation(a.confirm, phrase)
        }

        if (a.mode === 'test' && !a.to) throw new Error('mode "test" needs `to` — the address to send the sample digest to.')

        const body =
          a.mode === 'ping' ? { ping: true }
            : a.mode === 'dry' ? { dry: true }
              : a.mode === 'test' ? { test: a.to }
                : {}

        const r = await invokeReminders(body)
        if (a.response_format === ResponseFormat.JSON) return json({ mode: a.mode, ...r })

        if (!r.ok) {
          const lines = [`The reminder function reported a failure: ${r.error ?? 'unknown error'}`]
          if (r.missingSecrets?.length) lines.push(`Missing secrets: ${r.missingSecrets.join(', ')}.`)
          if (r.tcp) lines.push(`Mail server reachability: ${Object.entries(r.tcp).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
          return text(lines.join('\n'))
        }

        switch (a.mode) {
          case 'ping':
            return text([
              'Reminder function is up.',
              `- Booted: ${r.boot ?? 'yes'} · authenticated as ${r.authedAs ?? 'unknown'}`,
              `- Mail library: ${r.smtpLib ?? 'not loaded'}`,
              r.tcp ? `- Mail server: ${Object.entries(r.tcp).map(([k, v]) => `${k} ${v}`).join(' · ')}` : '',
              r.missingSecrets?.length ? `- **Missing secrets: ${r.missingSecrets.join(', ')}**` : '- All required secrets are present.',
            ].filter(Boolean).join('\n'))
          case 'dry':
            return text([
              `Dry run for ${r.today ?? 'today'} — nothing was sent.`,
              `- Would email: ${r.digestsSent?.length ? r.digestsSent.join(', ') : 'nobody'}`,
              `- Already sent today: ${r.alreadySentToday?.length ? r.alreadySentToday.join(', ') : 'none'}`,
              `- Managers to prompt about finished sequences: ${r.prompted ?? 0}`,
              `- Leads that would be auto-marked lost: ${r.autoLost ?? 0}`,
            ].join('\n'))
          case 'test':
            return text(`Sent a sample digest to **${a.to}**. If it does not arrive, run mode="ping" to check the SMTP settings.`)
          default:
            return text([
              `Reminder run complete for ${r.today ?? 'today'}.`,
              `- Digests sent: ${r.digestsSent?.length ? r.digestsSent.join(', ') : 'none'}`,
              `- Skipped (already sent today): ${r.alreadySentToday?.length ? r.alreadySentToday.join(', ') : 'none'}`,
              `- Prompted: ${r.prompted ?? 0} · auto-marked lost: ${r.autoLost ?? 0}`,
              r.failed?.length ? `- **Failed: ${r.failed.map((f) => `${f.to} (${f.error})`).join(', ')}**` : '',
            ].filter(Boolean).join('\n'))
        }
      },
    ),
  )
}
