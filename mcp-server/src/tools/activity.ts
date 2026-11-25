/**
 * Operational history: what was imported, and what the reminder job did.
 * Read-only, so it is available in every mode — knowing whether yesterday's
 * digest went out should not need write access.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { WORKSPACE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, json, safeText, table, text } from '../format.js'
import { fetchImportBatches, fetchReminderLog } from '../repo.js'
import { guard, workspace } from './common.js'

export function registerActivity(server: McpServer): void {
  server.registerTool(
    'leads_activity',
    {
      title: 'Import and reminder history',
      description: `What has happened to the tracker lately: CSV imports (file, when, rows inserted vs refreshed) and the reminder log (who was emailed, when, and whether it failed).

Use it to answer "did the digest go out?", "when was data last imported?", "why did nobody get a reminder yesterday?", and to get the batch ids leads_import needs to re-apply an upload.

Read-only.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        what: z.enum(['both', 'imports', 'reminders']).default('both').describe('Which history to return.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum entries per section.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project } = await workspace(a.workspace)
      const imports = a.what === 'reminders' ? [] : await fetchImportBatches(project.id, a.limit)
      const reminders = a.what === 'imports' ? [] : await fetchReminderLog(a.limit)

      const payload = {
        workspace: project.id,
        imports: imports.map((b) => ({
          batch_id: b.id,
          file: safeText(b.file_name, 160),
          uploaded_at: b.uploaded_at,
          rows_total: b.rows_total,
          rows_inserted: b.rows_inserted,
          rows_updated: b.rows_updated,
        })),
        reminders: reminders.map((r) => ({
          sent_on: r.sent_on,
          recipient: r.recipient,
          kind: r.kind,
          subject: safeText(r.subject, 200),
          step_count: r.step_count,
          status: r.status,
          error: r.error,
          workspace: r.project_id ?? null,
        })),
      }
      if (a.response_format === ResponseFormat.JSON) return json(payload)

      const lines = [`# Activity — ${project.name}`]
      if (a.what !== 'reminders') {
        lines.push('', '## Imports', '')
        lines.push(imports.length
          ? table(
            ['When', 'File', 'Rows', 'New', 'Refreshed', 'batch_id'],
            imports.map((b) => [
              (b.uploaded_at ?? '').slice(0, 16).replace('T', ' '),
              safeText(b.file_name, 50) || '-',
              b.rows_total ?? '-', b.rows_inserted ?? '-', b.rows_updated ?? '-',
              `\`${b.id}\``,
            ]),
            ['l', 'l', 'r', 'r', 'r', 'l'],
          )
          : 'No imports recorded for this workspace.')
      }
      if (a.what !== 'imports') {
        lines.push('', '## Reminder log', '')
        if (!reminders.length) {
          lines.push('No reminder has been logged yet. Run leads_run_reminders with mode="ping" to check the job is deployed.')
        } else {
          lines.push(table(
            ['Date', 'Recipient', 'Kind', 'Steps', 'Status', 'Error'],
            reminders.map((r) => [
              r.sent_on, r.recipient, r.kind, r.step_count, r.status, safeText(r.error, 80) || '-',
            ]),
            ['l', 'l', 'l', 'r', 'l', 'l'],
          ))
          const failed = reminders.filter((r) => r.status !== 'sent').length
          if (failed) lines.push('', `**${failed}** of the last ${reminders.length} reminder(s) did not send.`)
        }
      }
      return text(lines.join('\n'))
    }),
  )
}
