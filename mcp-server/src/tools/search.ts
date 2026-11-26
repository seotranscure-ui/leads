/**
 * Lead search and single-lead detail.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  chargePct, displayName, effectiveNotes, fmtInZone, fmtMoney, isDemoIn, isHigh, isLostIn, isWonIn,
  leadRevenue, monthKeyOf, PK_ZONE, SRC_ZONE, ticketValue, type Lead,
} from '../domain.js'
import { applyFilters, describeFilters, FILTER_SHAPE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, UNTRUSTED_NOTE, fitToBudget, json, safeText, table, text } from '../format.js'
import { fetchLeads, getLead } from '../repo.js'
import type { Ctx } from '../metrics.js'
import { guard, workspace } from './common.js'

const SORTS = ['created_desc', 'created_asc', 'collections_desc', 'collections_asc', 'revenue_desc', 'name_asc', 'stage'] as const

function sortLeads(leads: Lead[], sort: (typeof SORTS)[number], ctx: Ctx): Lead[] {
  const t = (l: Lead): number => ticketValue(l) ?? -1
  const c = (l: Lead): number => Date.parse(l.created_utc ?? '') || 0
  const order = ctx.funnel.stages.map((s) => s.name)
  const copy = [...leads]
  switch (sort) {
    case 'created_asc': return copy.sort((a, b) => c(a) - c(b))
    case 'collections_desc': return copy.sort((a, b) => t(b) - t(a))
    case 'collections_asc': return copy.sort((a, b) => t(a) - t(b))
    case 'revenue_desc': return copy.sort((a, b) => leadRevenue(b, ctx.chargePct) - leadRevenue(a, ctx.chargePct))
    case 'name_asc': return copy.sort((a, b) => displayName(a).localeCompare(displayName(b)))
    case 'stage': return copy.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || c(b) - c(a))
    default: return copy.sort((a, b) => c(b) - c(a))
  }
}

interface SummaryRow {
  record_id: string
  name: string
  practice: string
  specialty: string
  email: string | null
  phone: string | null
  source: string
  status: string
  stage: string
  owner: string | null
  monthly_collections: number | null
  charge_pct: number
  revenue_per_month: number
  high_ticket: boolean
  created_pk: string | null
}

function summaryRow(l: Lead, ctx: Ctx): SummaryRow {
  return {
    record_id: l.record_id,
    name: safeText(displayName(l), 120),
    practice: safeText(l.practice, 120),
    specialty: safeText(l.specialty, 80),
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: l.status,
    stage: l.stage,
    owner: l.lead_owner,
    monthly_collections: ticketValue(l),
    charge_pct: chargePct(l, ctx.chargePct),
    revenue_per_month: Math.round(leadRevenue(l, ctx.chargePct)),
    high_ticket: isHigh(l, ctx.rule),
    created_pk: fmtInZone(l.created_utc, PK_ZONE, false) || null,
  }
}

export function registerSearch(server: McpServer): void {
  server.registerTool(
    'leads_search',
    {
      title: 'Search leads',
      description: `Search and list leads in one workspace, or fetch one lead in full.

Pass \`record_id\` to get a single lead with every field including CRM comments, manual notes, source-tracking fields and timestamps. Otherwise pass filters to list matches.

Returns one page. When more matches exist, the result says so and gives next_offset; call again with that offset.

Examples:
  - "Dental leads we won this year" -> specialty="Dental", outcome="won", date_from="2026-01-01"
  - "Biggest open SEO deals" -> source=["SEO"], outcome="open", sort="collections_desc"
  - "Leads with no email" -> has_email=false

Use leads_metrics for counts and totals instead of listing everything, and leads_breakdown for per-group figures. Read-only.`,
      inputSchema: z.strictObject({
        ...FILTER_SHAPE,
        record_id: z.string().min(1).max(200).optional()
          .describe('Fetch exactly this lead in full detail; all other filters are ignored.'),
        sort: z.enum(SORTS).default('created_desc').describe('Order of the returned page.'),
        limit: z.number().int().min(1).max(200).default(25).describe('Maximum leads to return.'),
        offset: z.number().int().min(0).default(0).describe('Matches to skip, for pagination.'),
        include_notes: z.boolean().default(false)
          .describe('Include each lead\'s notes / CRM comments in a list result. Off by default because they are long.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx } = await workspace(a.workspace)

      if (a.record_id) {
        const lead = await getLead(a.record_id)
        if (!lead) {
          throw new Error(`No lead with record_id "${a.record_id}" in any workspace. Search by name to find the right id.`)
        }
        const notes = effectiveNotes(lead)
        const full = {
          ...summaryRow(lead, ctx),
          workspace: lead.project_id,
          company: lead.company,
          tag: lead.tag,
          physicians: lead.physicians,
          phase: lead.phase,
          reached_demo: isDemoIn(ctx.funnel, lead.stage, lead.status),
          won: isWonIn(ctx.funnel, lead.stage),
          lost: isLostIn(ctx.funnel, lead.stage),
          revenue_month: lead.manual_revenue_month || monthKeyOf(lead.created_utc).key,
          created_pk: fmtInZone(lead.created_utc, PK_ZONE),
          created_us_central: fmtInZone(lead.created_utc, SRC_ZONE),
          modified_pk: fmtInZone(lead.modified_utc, PK_ZONE),
          manual_updated_at: lead.manual_updated_at ?? null,
          notes: safeText(notes, 4000),
          message: safeText(lead.message, 2000),
          source_tracking: {
            source_medium: lead.manual_source_medium,
            first_landing: lead.manual_first_landing ?? lead.first_page,
            second_page: lead.manual_second_page,
            submit_page: lead.manual_submit_page,
            search_query: safeText(lead.manual_search_query, 300),
            recording: lead.manual_recording,
            referrer: lead.referrer,
          },
        }
        if (a.response_format === ResponseFormat.JSON) return json(full)
        const lines = [
          `# ${full.name}${lead.practice ? ` — ${safeText(lead.practice, 120)}` : ''}`,
          '',
          `\`${lead.record_id}\` · workspace \`${lead.project_id}\``,
          `- Stage **${lead.stage}** · status ${lead.status || '(blank)'} · source ${lead.source}`,
          `- ${lead.email || 'no email'} · ${lead.phone || 'no phone'} · owner ${lead.lead_owner || '(unassigned)'}`,
          `- Specialty ${lead.specialty || '-'} · physicians ${lead.physicians || '-'}`,
          `- Ticket ${fmtMoney(ticketValue(lead))}/mo · charge ${full.charge_pct}% · revenue ${fmtMoney(full.revenue_per_month as number)}/mo${full.high_ticket ? ' · **high ticket**' : ''}`,
          `- Created ${full.created_pk} PK (${full.created_us_central} US Central) · revenue month ${full.revenue_month}`,
          '',
        ]
        if (notes || lead.message) {
          lines.push(UNTRUSTED_NOTE, '')
          if (notes) lines.push('**Notes / CRM comments**', '', safeText(notes, 4000), '')
          if (lead.message) lines.push('**Form message**', '', safeText(lead.message, 2000), '')
        }
        const st = full.source_tracking
        if (st.source_medium || st.first_landing || st.search_query || st.submit_page) {
          lines.push('**Source tracking**')
          lines.push(`- Source/medium: ${st.source_medium || '-'}`)
          lines.push(`- First landing: ${st.first_landing || '-'}`)
          lines.push(`- Submit page: ${st.submit_page || '-'}`)
          lines.push(`- Possible query: ${st.search_query || '-'}`)
        }
        return text(lines.join('\n'))
      }

      const all = await fetchLeads(project.id)
      const matched = sortLeads(applyFilters(all, a, ctx.funnel, ctx.rule), a.sort, ctx)
      const total = matched.length
      const page = matched.slice(a.offset, a.offset + a.limit)

      const render = (slice: Lead[]) => {
        const nextOffset = a.offset + slice.length
        const hasMore = total > nextOffset
        const rows = slice.map((l) => {
          const base = summaryRow(l, ctx)
          return a.include_notes ? { ...base, notes: safeText(effectiveNotes(l), 600) } : base
        })
        const payload = {
          workspace: project.id,
          filters: describeFilters(a),
          total, count: slice.length, offset: a.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: nextOffset } : {}),
          leads: rows,
        }
        if (a.response_format === ResponseFormat.JSON) {
          return { payload, text: JSON.stringify(payload, null, 2) }
        }
        const lines = [
          `# Leads — ${project.name}`,
          `${total} match(es) for ${describeFilters(a)}; showing ${slice.length} from offset ${a.offset}.`,
          '',
        ]
        if (a.include_notes) lines.push(UNTRUSTED_NOTE, '')
        lines.push(table(
          ['Name', 'Practice', 'Stage', 'Status', 'Source', 'Ticket/mo', 'Rev/mo', 'Created', 'record_id'],
          slice.map((l) => [
            safeText(displayName(l), 60),
            safeText(l.practice, 40) || '-',
            l.stage + (isHigh(l, ctx.rule) ? ' *' : ''),
            safeText(l.status, 30) || '-',
            safeText(l.source, 24),
            fmtMoney(ticketValue(l)),
            fmtMoney(Math.round(leadRevenue(l, ctx.chargePct))),
            fmtInZone(l.created_utc, PK_ZONE, false) || '-',
            `\`${l.record_id}\``,
          ]),
          ['l', 'l', 'l', 'l', 'l', 'r', 'r', 'l', 'l'],
        ))
        lines.push('', '`*` = high ticket under this workspace\'s rule.')
        if (a.include_notes) {
          lines.push('')
          for (const l of slice) {
            const n = safeText(effectiveNotes(l), 600)
            if (n) lines.push(`- **${safeText(displayName(l), 60)}**: ${n}`)
          }
        }
        if (hasMore) lines.push('', `More results: call again with offset=${nextOffset}.`)
        return { payload, text: lines.join('\n') }
      }

      if (!total) {
        return text(`No leads in ${project.name} match ${describeFilters(a)}. Widen the filters, or check leads_list_workspaces for the right workspace.`)
      }

      const fitted = fitToBudget(page, render)
      if (a.response_format === ResponseFormat.JSON) {
        return { content: [{ type: 'text' as const, text: fitted.text }], structuredContent: fitted.payload }
      }
      return text(fitted.text)
    }),
  )
}
