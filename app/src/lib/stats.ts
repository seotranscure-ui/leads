import type { HighTicketRule, Lead } from './leads'
import { isHigh, leadRevenue, ticketValue, DEFAULT_CHARGE_PCT } from './leads'
import { isDemoIn, isWonIn, FALLBACK_FUNNEL, type FunnelConfig } from './projects'
import { monthKeyOf } from './time'

export interface MonthStat { key: string; label: string; leads: number; demos: number; sales: number; ht: number; coll: number; rev: number }

// Build a "Month YYYY" label from a 'YYYY-MM' key (for revenue months with no lead intake).
function labelForKey(key: string): string {
  if (key === 'unknown') return 'Unknown date'
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

// Optional per-basis filters: `createdIn` gates lead-intake metrics (by created month),
// `wonIn` gates the won money (by revenue month). Omit either for "include all".
// `funnel` decides which stages count as demo-reached and won; `chargePct` is the
// project's default charge rate. Both default to the original single-project
// behaviour when omitted.
export interface MonthlyOpts {
  createdIn?: (l: Lead) => boolean
  wonIn?: (l: Lead) => boolean
  funnel?: FunnelConfig
  chargePct?: number
}

export function monthlyStats(leads: Lead[], rule: HighTicketRule, opts?: MonthlyOpts): MonthStat[] {
  const funnel = opts?.funnel ?? FALLBACK_FUNNEL
  const charge = opts?.chargePct ?? DEFAULT_CHARGE_PCT
  const map: Record<string, MonthStat> = {}
  const bucket = (key: string, label: string) => {
    if (!map[key]) map[key] = { key, label, leads: 0, demos: 0, sales: 0, ht: 0, coll: 0, rev: 0 }
    return map[key]
  }
  for (const l of leads) {
    const created = monthKeyOf(l.created_utc)
    // Lead intake metrics belong to the month the lead came in.
    if (!opts?.createdIn || opts.createdIn(l)) {
      const cb = bucket(created.key, created.label)
      cb.leads++
      if (isDemoIn(funnel, l.stage)) cb.demos++
      if (isHigh(l, rule)) cb.ht++
    }
    // The win (sale + collections + revenue) is recognized in the revenue month (default: created month).
    if (isWonIn(funnel, l.stage) && (!opts?.wonIn || opts.wonIn(l))) {
      const attrKey = l.manual_revenue_month || created.key
      const ab = bucket(attrKey, attrKey === created.key ? created.label : labelForKey(attrKey))
      ab.sales++
      ab.coll += ticketValue(l) || 0
      ab.rev += leadRevenue(l, charge)
    }
  }
  return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1))
}

export const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')
export const specKey = (l: Lead) => (l.specialty || '').trim() || '(unspecified)'
export const monthKey = (l: Lead) => monthKeyOf(l.created_utc).key
// The month a won lead's sale/collections/revenue is recognized in (override, else created month).
export const revenueMonthKey = (l: Lead) => l.manual_revenue_month || monthKeyOf(l.created_utc).key
