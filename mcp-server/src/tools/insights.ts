/**
 * The analysis tool.
 *
 * Everything else answers a question that was asked. This one looks for the
 * things worth asking about: what moved, which segments actually differ once
 * sample size is accounted for, where money is sitting still, and which data
 * problems are quietly distorting the other reports.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  daysBetween, displayName, fmtMoney, isHigh, isUnmappedStatus, isWonIn, leadRevenue, monthKeyOf,
  pendingChannels, ruleLabel, stepComplete, ticketValue, todayIso,
  type FollowUpStep, type Lead,
} from '../domain.js'
import { applyFilters, describeFilters, FILTER_SHAPE } from '../filters.js'
import { ResponseFormat, RESPONSE_FORMAT, json, safeText, table, text } from '../format.js'
import {
  aggregate, change, compareWindows, groupBy, monthlyStats, ratePct, signed, sumRows, type Agg, type Ctx,
} from '../metrics.js'
import { fetchLeads, fetchSequences, fetchStepsFor } from '../repo.js'
import { guard, workspace } from './common.js'

const SECTIONS = [
  'headline', 'momentum', 'sources', 'specialties', 'high_ticket',
  'pipeline', 'followups', 'concentration', 'data_quality',
] as const
type Section = (typeof SECTIONS)[number]

/** Days since a lead last changed, falling back to when it arrived. */
function ageDays(l: Lead, today: string): number {
  const iso = (l.modified_utc || l.created_utc || '').slice(0, 10)
  return iso ? Math.max(0, daysBetween(iso, today)) : 0
}

interface SegmentRow { name: string; agg: Agg; conversion: number | null }

function rankSegments(leads: Lead[], key: (l: Lead) => string, ctx: Ctx, minSize: number): SegmentRow[] {
  return [...groupBy(leads, key, ctx).entries()]
    .filter(([, g]) => g.leads >= minSize)
    .map(([name, agg]) => ({ name, agg, conversion: agg.leads ? (agg.sales / agg.leads) * 100 : null }))
    .sort((a, b) => (b.conversion ?? -1) - (a.conversion ?? -1))
}

export function registerInsights(server: McpServer): void {
  server.registerTool(
    'leads_insights',
    {
      title: 'Insight report',
      description: `Analyse a workspace and report what stands out, rather than answering one specific question: recent momentum against the preceding period, which sources and specialties actually convert (sample size respected), whether high-ticket leads behave differently, where open pipeline is ageing, follow-up sequences that are overdue or about to auto-close, how concentrated revenue is in a few accounts, and data problems distorting every other report — unmapped CRM statuses, missing collections, missing contact details.

Use this for open-ended asks: "how are we doing", "what should I worry about", "anything odd in the numbers", a monthly review, or before a planning conversation.

Narrow it with \`sections\` when only part is wanted, and with the usual filters to scope the analysis. Read-only.

Examples:
  - "Give me the state of play" -> (no arguments)
  - "What is stuck?" -> sections=["pipeline","followups"]
  - "Is our data clean?" -> sections=["data_quality"]`,
      inputSchema: z.strictObject({
        ...FILTER_SHAPE,
        sections: z.array(z.enum(SECTIONS)).max(SECTIONS.length).optional()
          .describe(`Which parts to include. Defaults to all: ${SECTIONS.join(', ')}.`),
        months: z.number().int().min(1).max(12).default(3)
          .describe('Length in months of the recent window compared against the period before it.'),
        min_segment_size: z.number().int().min(1).max(500).default(8)
          .describe('Smallest group ranked by conversion. Below this a rate is noise, so the group is listed as low-volume instead.'),
        stale_days: z.number().int().min(1).max(365).default(45)
          .describe('An open lead untouched for this many days counts as ageing.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx, managerEmail } = await workspace(a.workspace)
      const want = new Set<Section>(a.sections?.length ? a.sections : [...SECTIONS])
      const today = todayIso()
      const all = await fetchLeads(project.id)
      const leads = applyFilters(all, a, ctx.funnel, ctx.rule)

      const out: Record<string, unknown> = {
        workspace: project.id,
        generated_for: describeFilters(a),
        lead_count: leads.length,
      }
      const md: string[] = [
        `# Insights — ${project.name}`,
        `${leads.length} lead(s) · ${describeFilters(a)} · charge ${ctx.chargePct}% · ${ruleLabel(ctx.rule)}`,
      ]
      const flags: string[] = []

      if (!leads.length) {
        return a.response_format === ResponseFormat.JSON
          ? json({ ...out, note: 'No leads match those filters.' })
          : text(md.join('\n') + '\n\nNo leads match those filters.')
      }

      const total = aggregate(leads, ctx)
      const byMonth = monthlyStats(leads, ctx)

      // ── headline ─────────────────────────────────────────────────────────
      if (want.has('headline')) {
        out.headline = {
          leads: total.leads, demos: total.demos, won: total.sales, lost: total.lost, open: total.open,
          leads_to_demos_pct: ratePct(total.demos, total.leads),
          demos_to_won_pct: ratePct(total.sales, total.demos),
          revenue_per_month: Math.round(total.revenue),
          open_pipeline_per_month: Math.round(total.pipelineValue),
          lost_revenue_per_month: Math.round(total.lostRevenue),
        }
        md.push('', '## Headline', '',
          `- **${total.leads}** leads → **${total.demos}** demos (${ratePct(total.demos, total.leads)}) → **${total.sales}** won (${ratePct(total.sales, total.demos)} of demos)`,
          `- Won revenue **${fmtMoney(total.revenue)}/mo** · open pipeline **${fmtMoney(total.pipelineValue)}/mo** · lost **${fmtMoney(total.lostRevenue)}/mo**`,
          `- ${total.open} lead(s) still open, ${total.lost} lost`,
        )
      }

      // ── momentum ─────────────────────────────────────────────────────────
      // Compares two equal windows ending with last *complete* month: including
      // a part-finished month would read as a collapse every month.
      if (want.has('momentum')) {
        const thisMonth = monthKeyOf(new Date().toISOString()).key
        const complete = byMonth.filter((m) => m.key !== 'unknown' && m.key < thisMonth)
        if (complete.length >= 2) {
          const lastKey = complete[0].key
          const split = compareWindows(lastKey, a.months)
          const olderKeys = new Set(split.older)
          const recentKeys = new Set(split.recent)
          const recent = sumRows(complete.filter((m) => recentKeys.has(m.key)))
          const older = sumRows(complete.filter((m) => olderKeys.has(m.key)))
          const deltas = {
            window_months: a.months,
            recent_through: lastKey,
            leads: { now: recent.leads, before: older.leads, change_pct: change(recent.leads, older.leads) },
            demos: { now: recent.demos, before: older.demos, change_pct: change(recent.demos, older.demos) },
            won: { now: recent.sales, before: older.sales, change_pct: change(recent.sales, older.sales) },
            revenue: { now: Math.round(recent.revenue), before: Math.round(older.revenue), change_pct: change(recent.revenue, older.revenue) },
            conversion_pct: { now: ratePct(recent.sales, recent.leads), before: ratePct(older.sales, older.leads) },
          }
          out.momentum = deltas
          md.push('', `## Momentum — last ${a.months} complete month(s) vs the ${a.months} before`, '',
            table(
              ['Measure', `Through ${lastKey}`, 'Previous', 'Change'],
              [
                ['Leads', recent.leads, older.leads, signed(deltas.leads.change_pct)],
                ['Demos', recent.demos, older.demos, signed(deltas.demos.change_pct)],
                ['Won', recent.sales, older.sales, signed(deltas.won.change_pct)],
                ['Revenue/mo', fmtMoney(recent.revenue), fmtMoney(older.revenue), signed(deltas.revenue.change_pct)],
                ['Lead→Won', ratePct(recent.sales, recent.leads), ratePct(older.sales, older.leads), ''],
              ],
              ['l', 'r', 'r', 'r'],
            ),
          )
          const dl = deltas.leads.change_pct
          if (dl != null && dl <= -25) flags.push(`Lead volume is down ${Math.abs(dl).toFixed(0)}% against the previous ${a.months} month(s).`)
          const dw = deltas.won.change_pct
          if (dw != null && dw <= -25) flags.push(`Wins are down ${Math.abs(dw).toFixed(0)}% against the previous ${a.months} month(s).`)
        } else {
          out.momentum = { note: 'Not enough complete months to compare.' }
          md.push('', '## Momentum', '', 'Not enough complete months to compare yet.')
        }
      }

      // ── segments ─────────────────────────────────────────────────────────
      const segmentBlock = (title: string, key: (l: Lead) => string, outKey: string): void => {
        const ranked = rankSegments(leads, key, ctx, a.min_segment_size)
        const lowVolume = [...groupBy(leads, key, ctx).entries()]
          .filter(([, g]) => g.leads < a.min_segment_size)
        out[outKey] = {
          ranked: ranked.map((r) => ({
            name: r.name, leads: r.agg.leads, demos: r.agg.demos, won: r.agg.sales,
            conversion_pct: r.conversion == null ? null : Number(r.conversion.toFixed(1)),
            revenue_per_month: Math.round(r.agg.revenue),
          })),
          below_min_size: lowVolume.length,
          min_segment_size: a.min_segment_size,
        }
        md.push('', `## ${title}`, '')
        if (!ranked.length) {
          md.push(`No group has at least ${a.min_segment_size} leads, so no rate here is meaningful. ${lowVolume.length} smaller group(s) exist.`)
          return
        }
        md.push(table(
          ['Group', 'Leads', 'Demos', 'Won', 'Lead→Won', 'Revenue/mo'],
          ranked.map((r) => [
            safeText(r.name, 48), r.agg.leads, r.agg.demos, r.agg.sales,
            ratePct(r.agg.sales, r.agg.leads), fmtMoney(r.agg.revenue),
          ]),
          ['l', 'r', 'r', 'r', 'r', 'r'],
        ))
        if (lowVolume.length) {
          md.push('', `${lowVolume.length} group(s) under ${a.min_segment_size} leads are excluded — too small for a rate to mean anything.`)
        }
        if (ranked.length >= 2) {
          const best = ranked[0]
          const worst = ranked[ranked.length - 1]
          if ((best.conversion ?? 0) > 0 && (worst.conversion ?? 0) * 2 < (best.conversion ?? 0) && worst.agg.leads >= a.min_segment_size) {
            flags.push(`${best.name} converts at ${ratePct(best.agg.sales, best.agg.leads)} against ${worst.name} at ${ratePct(worst.agg.sales, worst.agg.leads)} — both above the volume floor.`)
          }
        }
      }

      if (want.has('sources')) segmentBlock('By source', (l) => (l.source || '').trim() || '(blank)', 'sources')
      if (want.has('specialties')) segmentBlock('By specialty', (l) => (l.specialty || '').trim() || '(unspecified)', 'specialties')

      // ── high ticket ──────────────────────────────────────────────────────
      if (want.has('high_ticket')) {
        const ht = aggregate(leads.filter((l) => isHigh(l, ctx.rule)), ctx)
        const rest = aggregate(leads.filter((l) => !isHigh(l, ctx.rule)), ctx)
        out.high_ticket = {
          rule: ruleLabel(ctx.rule),
          high: { leads: ht.leads, won: ht.sales, conversion_pct: ratePct(ht.sales, ht.leads), revenue_per_month: Math.round(ht.revenue) },
          standard: { leads: rest.leads, won: rest.sales, conversion_pct: ratePct(rest.sales, rest.leads), revenue_per_month: Math.round(rest.revenue) },
          high_share_of_revenue_pct: total.revenue ? Number(((ht.revenue / total.revenue) * 100).toFixed(1)) : 0,
        }
        md.push('', '## High ticket vs standard', '', `Rule: ${ruleLabel(ctx.rule)}`, '',
          table(
            ['Band', 'Leads', 'Won', 'Lead→Won', 'Revenue/mo', 'Share of revenue'],
            [
              ['High ticket', ht.leads, ht.sales, ratePct(ht.sales, ht.leads), fmtMoney(ht.revenue),
                total.revenue ? ((ht.revenue / total.revenue) * 100).toFixed(1) + '%' : '-'],
              ['Standard', rest.leads, rest.sales, ratePct(rest.sales, rest.leads), fmtMoney(rest.revenue),
                total.revenue ? ((rest.revenue / total.revenue) * 100).toFixed(1) + '%' : '-'],
            ],
            ['l', 'r', 'r', 'r', 'r', 'r'],
          ),
        )
      }

      // ── pipeline ─────────────────────────────────────────────────────────
      if (want.has('pipeline')) {
        const open = leads.filter((l) => !isWonIn(ctx.funnel, l.stage) && !ctx.funnel.stages.find((s) => s.name === l.stage)?.lost)
        const stale = open.filter((l) => ageDays(l, today) >= a.stale_days)
          .sort((x, y) => leadRevenue(y, ctx.chargePct) - leadRevenue(x, ctx.chargePct))
        const staleValue = stale.reduce((s, l) => s + leadRevenue(l, ctx.chargePct), 0)
        const byStage = [...groupBy(open, (l) => l.stage, ctx).entries()]
          .sort((x, y) => ctx.funnel.stages.findIndex((s) => s.name === x[0]) - ctx.funnel.stages.findIndex((s) => s.name === y[0]))

        out.pipeline = {
          open_leads: open.length,
          open_value_per_month: Math.round(total.pipelineValue),
          stale_days: a.stale_days,
          stale_leads: stale.length,
          stale_value_per_month: Math.round(staleValue),
          by_stage: byStage.map(([stage, g]) => ({
            stage, leads: g.leads, value_per_month: Math.round(g.pipelineValue),
            median_age_days: median(open.filter((l) => l.stage === stage).map((l) => ageDays(l, today))),
          })),
          oldest_valuable: stale.slice(0, 10).map((l) => ({
            record_id: l.record_id, name: safeText(displayName(l), 80), stage: l.stage,
            age_days: ageDays(l, today), revenue_per_month: Math.round(leadRevenue(l, ctx.chargePct)),
          })),
        }
        md.push('', '## Open pipeline', '',
          `${open.length} open lead(s) worth **${fmtMoney(total.pipelineValue)}/mo** to us.`,
          '',
          table(
            ['Stage', 'Open', 'Value/mo', `Median age (days)`],
            byStage.map(([stage, g]) => [
              stage, g.leads, fmtMoney(g.pipelineValue),
              median(open.filter((l) => l.stage === stage).map((l) => ageDays(l, today))),
            ]),
            ['l', 'r', 'r', 'r'],
          ),
        )
        if (stale.length) {
          md.push('', `**${stale.length}** open lead(s) untouched for ${a.stale_days}+ days, carrying **${fmtMoney(staleValue)}/mo**. Largest:`, '',
            table(
              ['Lead', 'Stage', 'Age', 'Rev/mo', 'record_id'],
              stale.slice(0, 10).map((l) => [
                safeText(displayName(l), 48), l.stage, `${ageDays(l, today)}d`,
                fmtMoney(leadRevenue(l, ctx.chargePct)), `\`${l.record_id}\``,
              ]),
              ['l', 'l', 'r', 'r', 'l'],
            ),
          )
          if (staleValue > 0 && total.pipelineValue > 0 && staleValue / total.pipelineValue >= 0.4) {
            flags.push(`${Math.round((staleValue / total.pipelineValue) * 100)}% of open pipeline value has not moved in ${a.stale_days}+ days.`)
          }
        }
      }

      // ── follow-ups ───────────────────────────────────────────────────────
      if (want.has('followups')) {
        const seqs = await fetchSequences(project.id)
        const steps = await fetchStepsFor(seqs.map((s) => s.id))
        const bySeq = new Map<string, FollowUpStep[]>()
        for (const s of steps) {
          const arr = bySeq.get(s.sequence_id) ?? []
          arr.push(s)
          bySeq.set(s.sequence_id, arr)
        }
        const leadById = new Map(all.map((l) => [l.record_id, l]))
        const active = seqs.filter((s) => s.status === 'active')
        let overdue = 0
        let dueToday = 0
        let finished = 0
        let worstDays = 0
        const worst: { name: string; days: number; outstanding: string; record_id: string }[] = []
        const noEmail: string[] = []

        for (const seq of active) {
          const mine = (bySeq.get(seq.id) ?? []).sort((x, y) => x.step_number - y.step_number)
          const next = mine.find((s) => !stepComplete(s))
          if (!next) { finished++; continue }
          if (next.scheduled_date < today) {
            overdue++
            const days = daysBetween(next.scheduled_date, today)
            worstDays = Math.max(worstDays, days)
            const l = leadById.get(seq.lead_record_id)
            worst.push({
              name: safeText(l ? displayName(l) : seq.lead_record_id, 60),
              days,
              outstanding: pendingChannels(next).join(', ') || '-',
              record_id: seq.lead_record_id,
            })
          } else if (next.scheduled_date === today) dueToday++
          if (!(seq.manager_email ?? '').trim() && !managerEmail) noEmail.push(seq.lead_record_id)
        }
        worst.sort((x, y) => y.days - x.days)

        const enrolStage = project.follow_up_stage
        const shouldBeEnrolled = enrolStage
          ? all.filter((l) => l.stage === enrolStage && !seqs.some((s) => s.lead_record_id === l.record_id))
          : []

        out.followups = {
          sequences_total: seqs.length,
          active: active.length,
          overdue,
          due_today: dueToday,
          all_steps_done: finished,
          longest_overdue_days: worstDays,
          not_enrolled_but_in_stage: shouldBeEnrolled.length,
          enrol_stage: enrolStage,
          reminder_email: managerEmail || null,
          sequences_without_any_email: noEmail.length,
          most_overdue: worst.slice(0, 10),
        }
        md.push('', '## Follow-ups', '',
          `${active.length} active sequence(s) · **${overdue}** overdue · ${dueToday} due today · ${finished} with all five weeks done.`,
        )
        if (worst.length) {
          md.push('', table(
            ['Lead', 'Days overdue', 'Still owed', 'record_id'],
            worst.slice(0, 10).map((w) => [w.name, w.days, w.outstanding, `\`${w.record_id}\``]),
            ['l', 'r', 'l', 'l'],
          ))
        }
        if (shouldBeEnrolled.length) {
          flags.push(`${shouldBeEnrolled.length} lead(s) sit in "${enrolStage}" with no follow-up sequence — run leads_manage_followup action="provision".`)
        }
        if (!managerEmail && active.length) {
          flags.push('No reminder email is set for this workspace, so digests have nowhere to go.')
        }
        if (finished) {
          flags.push(`${finished} sequence(s) have finished all five weeks and are waiting on a won/lost decision.`)
        }
      }

      // ── concentration ────────────────────────────────────────────────────
      if (want.has('concentration')) {
        const won = leads.filter((l) => isWonIn(ctx.funnel, l.stage))
          .map((l) => ({ l, rev: leadRevenue(l, ctx.chargePct) }))
          .filter((x) => x.rev > 0)
          .sort((x, y) => y.rev - x.rev)
        const sum = won.reduce((s, x) => s + x.rev, 0)
        const topN = Math.min(5, won.length)
        const topSum = won.slice(0, topN).reduce((s, x) => s + x.rev, 0)
        const share = sum ? (topSum / sum) * 100 : 0
        out.concentration = {
          won_clients: won.length,
          revenue_per_month: Math.round(sum),
          top_n: topN,
          top_n_share_pct: Number(share.toFixed(1)),
          top: won.slice(0, topN).map((x) => ({
            record_id: x.l.record_id, name: safeText(displayName(x.l), 80),
            revenue_per_month: Math.round(x.rev),
            share_pct: sum ? Number(((x.rev / sum) * 100).toFixed(1)) : 0,
          })),
        }
        md.push('', '## Revenue concentration', '')
        if (!won.length) {
          md.push('No won lead carries a collection figure, so revenue cannot be attributed.')
        } else {
          md.push(`Top ${topN} of ${won.length} won account(s) carry **${share.toFixed(1)}%** of ${fmtMoney(sum)}/mo.`, '',
            table(
              ['Account', 'Revenue/mo', 'Share'],
              won.slice(0, topN).map((x) => [
                safeText(displayName(x.l), 48), fmtMoney(x.rev),
                sum ? ((x.rev / sum) * 100).toFixed(1) + '%' : '-',
              ]),
              ['l', 'r', 'r'],
            ),
          )
          if (share >= 60 && won.length >= 3) {
            flags.push(`${share.toFixed(0)}% of revenue sits with ${topN} account(s) — losing one would hurt disproportionately.`)
          }
        }
      }

      // ── data quality ─────────────────────────────────────────────────────
      if (want.has('data_quality')) {
        const unmapped = new Map<string, number>()
        for (const l of leads) {
          if (isUnmappedStatus(ctx.funnel, l.status)) {
            const k = (l.status || '').trim()
            unmapped.set(k, (unmapped.get(k) ?? 0) + 1)
          }
        }
        const noTicket = leads.filter((l) => ticketValue(l) == null)
        const wonNoTicket = leads.filter((l) => isWonIn(ctx.funnel, l.stage) && ticketValue(l) == null)
        const noEmail = leads.filter((l) => !(l.email || '').trim())
        const noOwner = leads.filter((l) => !(l.lead_owner || '').trim())
        const noDate = leads.filter((l) => !l.created_utc)

        out.data_quality = {
          unmapped_statuses: [...unmapped.entries()].sort((x, y) => y[1] - x[1]).map(([status, count]) => ({ status, count })),
          leads_without_collections: noTicket.length,
          won_without_collections: wonNoTicket.length,
          leads_without_email: noEmail.length,
          leads_without_owner: noOwner.length,
          leads_without_created_date: noDate.length,
        }
        md.push('', '## Data quality', '')
        const dq: string[] = []
        if (unmapped.size) {
          dq.push(`- **${[...unmapped.values()].reduce((s, n) => s + n, 0)}** lead(s) carry a CRM status no funnel stage claims, so they fall back to "${ctx.funnel.stages[0]?.name}": ` +
            [...unmapped.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([s, n]) => `${safeText(s, 40)} (${n})`).join(', '))
          flags.push(`${unmapped.size} CRM status value(s) are not mapped to any stage — those leads are counted in "${ctx.funnel.stages[0]?.name}" regardless of where they really are.`)
        }
        if (wonNoTicket.length) {
          dq.push(`- **${wonNoTicket.length}** won lead(s) have no monthly collections, so they contribute nothing to revenue.`)
          flags.push(`${wonNoTicket.length} won lead(s) have no collection figure — revenue is understated by however much they are worth.`)
        }
        dq.push(`- ${noTicket.length} lead(s) with no collections figure · ${noEmail.length} with no email · ${noOwner.length} with no owner`)
        if (noDate.length) dq.push(`- **${noDate.length}** lead(s) have no created date and land in "Unknown date" in every monthly view.`)
        md.push(...dq)
      }

      // ── what to look at ──────────────────────────────────────────────────
      out.flags = flags
      if (flags.length) {
        md.push('', '## Worth a look', '', ...flags.map((f) => `- ${f}`))
      } else {
        md.push('', '## Worth a look', '', '- Nothing crossed the thresholds in this report.')
      }

      return a.response_format === ResponseFormat.JSON ? json(out) : text(md.join('\n'))
    }),
  )
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
