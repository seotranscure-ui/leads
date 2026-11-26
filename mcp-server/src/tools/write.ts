/**
 * Lead writes: edit the manual enrichment fields, move a lead through the
 * funnel, and add a lead by hand.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  displayName, fmtMoney, leadRevenue, scopedRecordId, stageForIn, ticketValue,
  type ManualPatch,
} from '../domain.js'
import { WORKSPACE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, json, safeText, sanitiseForStorage, text } from '../format.js'
import { createLead, getLead, saveManual, updateLeadStageAndStatus } from '../repo.js'
import { guardWrite, workspace } from './common.js'

const clean = (s: string | null | undefined): string | null =>
  s == null ? null : sanitiseForStorage(s).trim() || null

export function registerWrite(server: McpServer): void {
  server.registerTool(
    'leads_update',
    {
      title: 'Update a lead',
      description: `Change one lead.

Two kinds of change, and they can be combined in one call:
  - Enrichment entered in the tool (never overwritten by a CSV import): ticket override, high-ticket override, notes, charge %, revenue month, and the source-tracking fields.
  - Pipeline position: set \`status\` to the CRM status. The funnel stage is derived from it using this workspace's mapping, unless you also pass \`stage\` explicitly.

Pass null to clear a field. Omitted fields are left alone.

Examples:
  - "This one is actually worth 80k a month" -> record_id="...", ticket=80000
  - "Mark it as agreement sent" -> record_id="...", status="Agreement Sent"
  - "Bill this client at 7%" -> record_id="...", charge_pct=7
  - "Recognise the revenue in March" -> record_id="...", revenue_month="2026-03"`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        record_id: z.string().min(1).max(200).describe('The lead to change. leads_search returns these.'),
        ticket: z.number().min(0).nullish()
          .describe('Override of monthly collections in dollars. null restores the CRM value.'),
        high_ticket: z.boolean().nullish()
          .describe('Force high-ticket on or off. null returns the lead to the workspace rule.'),
        notes: z.string().max(10000).nullish().describe('Notes shown instead of the CRM comments. null clears them.'),
        charge_pct: z.number().min(0).max(100).nullish()
          .describe('Percent of collections billed for this lead. null uses the workspace default.'),
        revenue_month: z.string().regex(/^\d{4}-\d{2}$/).nullish()
          .describe("Month a won lead's revenue is recognised in, e.g. '2026-03'. null uses its arrival month."),
        source_medium: z.string().max(300).nullish().describe('Source / medium, e.g. "google / organic".'),
        first_landing: z.string().max(500).nullish().describe('First landing page.'),
        second_page: z.string().max(500).nullish().describe('Second page visited.'),
        submit_page: z.string().max(500).nullish().describe('Page the form was submitted from.'),
        search_query: z.string().max(300).nullish().describe('Probable search query.'),
        recording: z.string().max(500).nullish().describe('Session-recording link.'),
        status: z.string().max(100).optional()
          .describe('CRM lead status. The funnel stage follows from it unless `stage` is given too.'),
        stage: z.string().max(60).optional()
          .describe('Funnel stage, when it must differ from what the status maps to. Must be a stage of this workspace.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_update', action: 'update', workspace: a.workspace, targets: [a.record_id] }),
      async (a) => {
        const { project, ctx } = await workspace(a.workspace)
        const before = await getLead(a.record_id)
        if (!before) throw new Error(`No lead with record_id "${a.record_id}". Find it with leads_search first.`)

        const patch: ManualPatch = {}
        const set = <K extends keyof ManualPatch>(k: K, v: ManualPatch[K] | undefined): void => {
          if (v !== undefined) patch[k] = v
        }
        set('manual_ticket', a.ticket)
        set('manual_high', a.high_ticket)
        set('manual_notes', a.notes === undefined ? undefined : clean(a.notes))
        set('manual_charge_pct', a.charge_pct)
        set('manual_revenue_month', a.revenue_month)
        set('manual_source_medium', a.source_medium === undefined ? undefined : clean(a.source_medium))
        set('manual_first_landing', a.first_landing === undefined ? undefined : clean(a.first_landing))
        set('manual_second_page', a.second_page === undefined ? undefined : clean(a.second_page))
        set('manual_submit_page', a.submit_page === undefined ? undefined : clean(a.submit_page))
        set('manual_search_query', a.search_query === undefined ? undefined : clean(a.search_query))
        set('manual_recording', a.recording === undefined ? undefined : clean(a.recording))

        const changed: string[] = []
        if (Object.keys(patch).length) {
          await saveManual(a.record_id, patch)
          changed.push(...Object.keys(patch))
        }

        let stageNow = before.stage
        if (a.status !== undefined || a.stage !== undefined) {
          const status = a.status ?? before.status
          const stage = a.stage ?? stageForIn(project.funnel, status)
          const names = project.funnel.stages.map((s) => s.name)
          if (!names.includes(stage)) {
            throw new Error(`"${stage}" is not a stage in ${project.name}. Stages: ${names.join(', ')}.`)
          }
          await updateLeadStageAndStatus(a.record_id, sanitiseForStorage(status), stage)
          stageNow = stage
          changed.push('status', 'stage')
        }

        if (!changed.length) throw new Error('Nothing to change — pass at least one field.')

        const after = await getLead(a.record_id)
        const payload = {
          ok: true,
          record_id: a.record_id,
          name: after ? safeText(displayName(after), 120) : null,
          changed,
          stage_before: before.stage,
          stage_after: stageNow,
          ticket: after ? ticketValue(after) : null,
          revenue_per_month: after ? Math.round(leadRevenue(after, ctx.chargePct)) : null,
        }
        if (a.response_format === ResponseFormat.JSON) return json(payload)
        const lines = [`Updated **${payload.name ?? a.record_id}** (\`${a.record_id}\`).`, `Changed: ${changed.join(', ')}.`]
        if (before.stage !== stageNow) lines.push(`Stage: ${before.stage} → **${stageNow}**.`)
        if (after && ticketValue(after) !== ticketValue(before)) {
          lines.push(`Ticket: ${fmtMoney(ticketValue(before))} → **${fmtMoney(ticketValue(after))}**/mo (revenue ${fmtMoney(payload.revenue_per_month!)}/mo).`)
        }
        return text(lines.join('\n'))
      },
    ),
  )

  server.registerTool(
    'leads_create',
    {
      title: 'Add a lead',
      description: `Add one lead by hand, for something that did not come through the CRM export.

\`record_id\` must be unique. Give one explicitly to match a CRM record, or leave it out and a timestamped id is generated. In a workspace with a record-id prefix the id is namespaced automatically, so ids cannot collide between workspaces.

The funnel stage is derived from \`status\` using this workspace's mapping.

Example: "Add a referral, Dr Chen at Lakeside Dental, 40k a month, demo scheduled"
  -> name="Dr Chen", practice="Lakeside Dental", monthly_collections=40000, status="Demo Scheduled", source="Referral"`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        record_id: z.string().max(200).optional().describe('Unique id. Generated when omitted.'),
        name: z.string().min(1).max(200).describe('Lead name.'),
        email: z.string().max(200).nullish().describe('Email address.'),
        phone: z.string().max(60).nullish().describe('Phone number.'),
        company: z.string().max(200).nullish().describe('Company.'),
        practice: z.string().max(200).nullish().describe('Practice name.'),
        specialty: z.string().max(120).nullish().describe('Specialty, e.g. "Dental".'),
        physicians: z.string().max(40).nullish().describe('Physician count or range, e.g. "2-5".'),
        source: z.string().max(100).default('Manual').describe('Lead source, e.g. "SEO", "Referral".'),
        status: z.string().max(100).default('').describe('CRM status. The funnel stage is derived from it.'),
        owner: z.string().max(120).nullish().describe('Lead owner.'),
        monthly_collections: z.number().min(0).nullish().describe('Monthly collections (ticket value) in dollars.'),
        notes: z.string().max(10000).nullish().describe('Notes.'),
        created: z.string().datetime({ offset: true }).optional()
          .describe('When the lead arrived, ISO 8601 with offset. Defaults to now.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_create', action: 'insert', workspace: a.workspace, targets: a.record_id ? [a.record_id] : undefined }),
      async (a) => {
        const { project, ctx } = await workspace(a.workspace)
        const rawId = a.record_id?.trim() || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const recordId = scopedRecordId(project, rawId)
        if (await getLead(recordId)) {
          throw new Error(`A lead with record_id "${recordId}" already exists. Use leads_update to change it.`)
        }
        const name = sanitiseForStorage(a.name).trim()
        const stage = stageForIn(project.funnel, a.status)
        await createLead({
          record_id: recordId,
          project_id: project.id,
          lead_name: name,
          first_name: null,
          last_name: null,
          email: clean(a.email),
          phone: clean(a.phone),
          company: clean(a.company),
          practice: clean(a.practice) ?? clean(a.company),
          specialty: clean(a.specialty),
          physicians: clean(a.physicians),
          lead_owner: clean(a.owner),
          source: sanitiseForStorage(a.source).trim() || 'Manual',
          status: sanitiseForStorage(a.status).trim(),
          stage,
          monthly_collections: a.monthly_collections ?? null,
          manual_notes: clean(a.notes),
          created_utc: a.created ?? new Date().toISOString(),
          modified_utc: new Date().toISOString(),
        })
        const payload = {
          ok: true, record_id: recordId, workspace: project.id, name, stage,
          revenue_per_month: a.monthly_collections ? Math.round((a.monthly_collections * ctx.chargePct) / 100) : 0,
        }
        if (a.response_format === ResponseFormat.JSON) return json(payload)
        return text(
          `Added **${name}** to ${project.name} as \`${recordId}\`.\n` +
          `Stage **${stage}** (from status "${a.status || '(blank)'}")` +
          (a.monthly_collections ? ` · ${fmtMoney(a.monthly_collections)}/mo → ${fmtMoney(payload.revenue_per_month)}/mo to us.` : '.'),
        )
      },
    ),
  )
}
