/**
 * Aggregate reporting: headline metrics, group-by breakdowns and the monthly
 * table. All three share metrics.ts, so their numbers reconcile.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { fmtMoney, labelForKey, ruleLabel } from '../domain.js'
import { applyFilters, describeFilters, dimensionValue, DIMENSIONS, FILTER_SHAPE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, bullet, json, safeText, table, text } from '../format.js'
import { aggregate, groupBy, monthlyStats, ratePct, type Agg } from '../metrics.js'
import { fetchLeads } from '../repo.js'
import { guard, workspace } from './common.js'

const money = (n: number): number => Math.round(n)

function aggPayload(a: Agg): Record<string, unknown> {
  return {
    leads: a.leads,
    demos: a.demos,
    sales: a.sales,
    lost: a.lost,
    open: a.open,
    high_ticket: a.highTicket,
    leads_to_demos_pct: ratePct(a.demos, a.leads),
    demos_to_sales_pct: ratePct(a.sales, a.demos),
    leads_to_sales_pct: ratePct(a.sales, a.leads),
    won_collections_per_month: money(a.wonCollections),
    revenue_per_month: money(a.revenue),
    open_pipeline_revenue_per_month: money(a.pipelineValue),
    lost_revenue_per_month: money(a.lostRevenue),
  }
}

export function registerAnalyze(server: McpServer): void {
  server.registerTool(
    'leads_metrics',
    {
      title: 'Lead metrics',
      description: `Headline funnel and money figures for a filtered set of leads: counts, conversion rates, won collections, our revenue, open pipeline value and lost revenue.

Accepts exactly the same filters as leads_search, so any list can be turned into its totals without paging through it.

Examples:
  - "How did SEO do in April?" -> source=["SEO"], month="2026-04"
  - "What is our open pipeline worth?" -> outcome="open"
  - "Conversion for high-ticket leads" -> high_ticket="yes"

"Revenue" is our charge % of monthly collections, not the client's collections. Read-only.`,
      inputSchema: z.strictObject({ ...FILTER_SHAPE, response_format: RESPONSE_FORMAT }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx } = await workspace(a.workspace)
      const leads = applyFilters(await fetchLeads(project.id), a, ctx.funnel, ctx.rule)
      const agg = aggregate(leads, ctx)
      const payload = {
        workspace: project.id,
        filters: describeFilters(a),
        charge_pct_default: ctx.chargePct,
        high_ticket_rule: ruleLabel(ctx.rule),
        ...aggPayload(agg),
      }
      if (a.response_format === ResponseFormat.JSON) return json(payload)
      return text([
        `# Metrics — ${project.name}`,
        `Filters: ${describeFilters(a)}`,
        '',
        bullet('Leads', agg.leads),
        bullet('Reached demo', `${agg.demos} (${ratePct(agg.demos, agg.leads)} of leads)`),
        bullet('Won', `${agg.sales} (${ratePct(agg.sales, agg.demos)} of demos, ${ratePct(agg.sales, agg.leads)} of leads)`),
        bullet('Lost', agg.lost),
        bullet('Still open', agg.open),
        bullet('High ticket', `${agg.highTicket} (${ruleLabel(ctx.rule)})`),
        '',
        bullet('Won collections', `${fmtMoney(agg.wonCollections)}/mo`),
        bullet(`Our revenue (won, ${ctx.chargePct}% default)`, `${fmtMoney(agg.revenue)}/mo`),
        bullet('Open pipeline (our charge)', `${fmtMoney(agg.pipelineValue)}/mo`),
        bullet('Lost revenue (our charge)', `${fmtMoney(agg.lostRevenue)}/mo`),
      ].join('\n'))
    }),
  )

  server.registerTool(
    'leads_breakdown',
    {
      title: 'Breakdown by dimension',
      description: `Group a filtered set of leads by one dimension and report counts, conversion and money for each group.

Dimensions: source, specialty, stage, status, owner, month, practice, physicians, high_ticket.

Examples:
  - "Which source converts best?" -> dimension="source", sort="conversion"
  - "Revenue by specialty this year" -> dimension="specialty", date_from="2026-01-01", sort="revenue"
  - "Where is the pipeline sitting?" -> dimension="stage", outcome="open"

Use min_group_size when ranking by conversion: a source with two leads and one win reads as 50% and means nothing. Read-only.`,
      inputSchema: z.strictObject({
        ...FILTER_SHAPE,
        dimension: z.enum(DIMENSIONS).describe('Field to group by.'),
        sort: z.enum(['leads', 'revenue', 'sales', 'conversion', 'name']).default('leads')
          .describe('Order of the groups. "conversion" is won / leads.'),
        min_group_size: z.number().int().min(1).default(1)
          .describe('Drop groups with fewer leads than this. Use ~10 before ranking by conversion.'),
        limit: z.number().int().min(1).max(100).default(30).describe('Maximum groups to return.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx } = await workspace(a.workspace)
      const leads = applyFilters(await fetchLeads(project.id), a, ctx.funnel, ctx.rule)
      const grouped = groupBy(leads, (l) => dimensionValue(l, a.dimension, ctx.rule), ctx)

      let rows = [...grouped.entries()].filter(([, g]) => g.leads >= a.min_group_size)
      const conv = (g: Agg): number => (g.leads ? g.sales / g.leads : 0)
      rows.sort((x, y) => {
        switch (a.sort) {
          case 'revenue': return y[1].revenue - x[1].revenue
          case 'sales': return y[1].sales - x[1].sales
          case 'conversion': return conv(y[1]) - conv(x[1])
          case 'name': return x[0].localeCompare(y[0])
          default: return y[1].leads - x[1].leads
        }
      })
      const shown = rows.slice(0, a.limit)
      const label = (k: string): string => (a.dimension === 'month' ? labelForKey(k) : safeText(k, 60))

      const payload = {
        workspace: project.id,
        dimension: a.dimension,
        filters: describeFilters(a),
        groups_total: rows.length,
        groups_shown: shown.length,
        min_group_size: a.min_group_size,
        groups: shown.map(([k, g]) => ({ [a.dimension]: label(k), ...aggPayload(g) })),
      }
      if (a.response_format === ResponseFormat.JSON) return json(payload)
      if (!shown.length) {
        return text(`No groups with at least ${a.min_group_size} lead(s) for ${describeFilters(a)}.`)
      }
      return text([
        `# ${project.name} — by ${a.dimension}`,
        `Filters: ${describeFilters(a)}${a.min_group_size > 1 ? ` · groups with <${a.min_group_size} leads hidden` : ''}`,
        '',
        table(
          [a.dimension, 'Leads', 'Demos', 'Won', 'Lost', 'L→D', 'D→W', 'Collections', 'Revenue/mo', 'Open pipe'],
          shown.map(([k, g]) => [
            label(k), g.leads, g.demos, g.sales, g.lost,
            ratePct(g.demos, g.leads), ratePct(g.sales, g.demos),
            fmtMoney(g.wonCollections), fmtMoney(g.revenue), fmtMoney(g.pipelineValue),
          ]),
          ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
        ),
        rows.length > shown.length ? `\n${rows.length - shown.length} more group(s) not shown — raise limit.` : '',
      ].join('\n'))
    }),
  )

  server.registerTool(
    'leads_monthly_performance',
    {
      title: 'Monthly performance',
      description: `Month-by-month table: leads and demos by the month the lead arrived, and sales, collections and revenue recognised in each won lead's revenue month (its arrival month unless overridden on the lead).

That split is why this is not the same as leads_breakdown with dimension="month", which attributes everything to the arrival month.

Newest month first. Accepts the same filters as leads_search. Read-only.`,
      inputSchema: z.strictObject({
        ...FILTER_SHAPE,
        limit: z.number().int().min(1).max(60).default(24).describe('How many months to return, newest first.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx } = await workspace(a.workspace)
      const leads = applyFilters(await fetchLeads(project.id), a, ctx.funnel, ctx.rule)
      const rows = monthlyStats(leads, ctx).slice(0, a.limit)
      const payload = {
        workspace: project.id,
        filters: describeFilters(a),
        months: rows.map((r) => ({ month: r.key, label: r.label, ...aggPayload(r) })),
      }
      if (a.response_format === ResponseFormat.JSON) return json(payload)
      if (!rows.length) return text(`No months to report for ${describeFilters(a)}.`)
      return text([
        `# Monthly performance — ${project.name}`,
        `Filters: ${describeFilters(a)}`,
        '',
        table(
          ['Month', 'Leads', 'Demos', 'Sales', 'Collections', 'Revenue/mo', 'L→D', 'D→S'],
          rows.map((r) => [
            r.label, r.leads, r.demos, r.sales,
            fmtMoney(r.wonCollections), fmtMoney(r.revenue),
            ratePct(r.demos, r.leads), ratePct(r.sales, r.demos),
          ]),
          ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
        ),
      ].join('\n'))
    }),
  )
}
