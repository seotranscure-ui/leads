/**
 * Aggregation. One implementation of "what counts as a demo, a sale, a dollar"
 * feeds metrics, breakdowns, the monthly table and the insight report, so those
 * four can never disagree with each other — or with the dashboard, whose rules
 * these mirror.
 */
import {
  isDemoIn, isHigh, isLostIn, isWonIn, labelForKey, monthKeyOf, ticketValue, leadRevenue,
  type FunnelConfig, type HighTicketRule, type Lead,
} from './domain.js'

export interface Agg {
  leads: number
  demos: number
  sales: number
  lost: number
  open: number
  highTicket: number
  /** Monthly collections of won leads. */
  wonCollections: number
  /** Our monthly revenue from won leads. */
  revenue: number
  /** Our charge % applied to open (not yet won, not lost) leads with a ticket. */
  pipelineValue: number
  /** Our charge % applied to leads that reached a terminal "lost" stage. */
  lostRevenue: number
}

export const emptyAgg = (): Agg => ({
  leads: 0, demos: 0, sales: 0, lost: 0, open: 0, highTicket: 0,
  wonCollections: 0, revenue: 0, pipelineValue: 0, lostRevenue: 0,
})

export interface Ctx {
  funnel: FunnelConfig
  rule: HighTicketRule
  chargePct: number
}

export function accumulate(a: Agg, l: Lead, ctx: Ctx): void {
  const won = isWonIn(ctx.funnel, l.stage)
  const lost = isLostIn(ctx.funnel, l.stage)
  const rev = leadRevenue(l, ctx.chargePct)
  a.leads++
  if (isDemoIn(ctx.funnel, l.stage, l.status)) a.demos++
  if (isHigh(l, ctx.rule)) a.highTicket++
  if (won) {
    a.sales++
    a.wonCollections += ticketValue(l) ?? 0
    a.revenue += rev
  } else if (lost) {
    a.lost++
    a.lostRevenue += rev
  } else {
    a.open++
    a.pipelineValue += rev
  }
}

export function aggregate(leads: Lead[], ctx: Ctx): Agg {
  const a = emptyAgg()
  for (const l of leads) accumulate(a, l, ctx)
  return a
}

export function groupBy(leads: Lead[], key: (l: Lead) => string, ctx: Ctx): Map<string, Agg> {
  const out = new Map<string, Agg>()
  for (const l of leads) {
    const k = key(l)
    let a = out.get(k)
    if (!a) { a = emptyAgg(); out.set(k, a) }
    accumulate(a, l, ctx)
  }
  return out
}

export interface MonthRow extends Agg { key: string; label: string }

/**
 * Per-month table.
 *
 * Intake (leads, demos, high-ticket) belongs to the month the lead arrived;
 * the money is recognised in the won lead's revenue month, which defaults to
 * its arrival month but can be overridden per lead. That split is why this
 * cannot just be `groupBy(month)`.
 */
export function monthlyStats(leads: Lead[], ctx: Ctx): MonthRow[] {
  const map = new Map<string, MonthRow>()
  const bucket = (key: string, label: string): MonthRow => {
    let row = map.get(key)
    if (!row) { row = { key, label, ...emptyAgg() }; map.set(key, row) }
    return row
  }

  for (const l of leads) {
    const created = monthKeyOf(l.created_utc)
    const cb = bucket(created.key, created.label)
    cb.leads++
    if (isDemoIn(ctx.funnel, l.stage, l.status)) cb.demos++
    if (isHigh(l, ctx.rule)) cb.highTicket++
    const won = isWonIn(ctx.funnel, l.stage)
    const lost = isLostIn(ctx.funnel, l.stage)
    const rev = leadRevenue(l, ctx.chargePct)
    if (lost) { cb.lost++; cb.lostRevenue += rev }
    if (!won && !lost) { cb.open++; cb.pipelineValue += rev }

    if (won) {
      const key = l.manual_revenue_month || created.key
      const ab = bucket(key, key === created.key ? created.label : labelForKey(key))
      ab.sales++
      ab.wonCollections += ticketValue(l) ?? 0
      ab.revenue += rev
    }
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1))
}

export const rate = (a: number, b: number): number | null => (b ? (a / b) * 100 : null)
export const ratePct = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')

/** Month keys for the N months ending at `endKey`, oldest first. */
export function recentMonthKeys(endKey: string, n: number): string[] {
  const [y, m] = endKey.split('-').map(Number)
  if (!y || !m) return []
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Split the 2N months ending at `endKey` into the recent N and the N before
 * them. The two halves must be adjacent and must not overlap, or a
 * period-on-period change is measuring the wrong thing.
 */
export function compareWindows(endKey: string, months: number): { older: string[]; recent: string[] } {
  const window = recentMonthKeys(endKey, months * 2)
  return { older: window.slice(0, months), recent: window.slice(months) }
}

export function sumRows(rows: MonthRow[]): Agg {
  const a = emptyAgg()
  for (const r of rows) {
    a.leads += r.leads; a.demos += r.demos; a.sales += r.sales; a.lost += r.lost
    a.open += r.open; a.highTicket += r.highTicket
    a.wonCollections += r.wonCollections; a.revenue += r.revenue
    a.pipelineValue += r.pipelineValue; a.lostRevenue += r.lostRevenue
  }
  return a
}

/** Percentage change, or null when the baseline is zero (growth is undefined). */
export function change(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / before) * 100
}

export const signed = (n: number | null, suffix = '%'): string =>
  n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}${suffix}`
