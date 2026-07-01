import type { HighTicketRule, Lead } from './leads'
import { isDemo, isWon } from './funnel'
import { isHigh, leadRevenue, ticketValue } from './leads'
import { monthKeyOf } from './time'

export interface MonthStat { key: string; label: string; leads: number; demos: number; sales: number; ht: number; coll: number; rev: number }

// Build a "Month YYYY" label from a 'YYYY-MM' key (for revenue months with no lead intake).
function labelForKey(key: string): string {
  if (key === 'unknown') return 'Unknown date'
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

export function monthlyStats(leads: Lead[], rule: HighTicketRule, filter?: (l: Lead) => boolean): MonthStat[] {
  const map: Record<string, MonthStat> = {}
  const bucket = (key: string, label: string) => {
    if (!map[key]) map[key] = { key, label, leads: 0, demos: 0, sales: 0, ht: 0, coll: 0, rev: 0 }
    return map[key]
  }
  for (const l of leads) {
    if (filter && !filter(l)) continue
    const created = monthKeyOf(l.created_utc)
    // Lead intake metrics belong to the month the lead came in.
    const cb = bucket(created.key, created.label)
    cb.leads++
    if (isDemo(l.stage)) cb.demos++
    if (isHigh(l, rule)) cb.ht++
    // The win (sale + collections + revenue) is recognized in the revenue month (default: created month).
    if (isWon(l.stage)) {
      const attrKey = l.manual_revenue_month || created.key
      const ab = bucket(attrKey, attrKey === created.key ? created.label : labelForKey(attrKey))
      ab.sales++
      ab.coll += ticketValue(l) || 0
      ab.rev += leadRevenue(l)
    }
  }
  return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1))
}

export const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')
export const specKey = (l: Lead) => (l.specialty || '').trim() || '(unspecified)'
export const monthKey = (l: Lead) => monthKeyOf(l.created_utc).key
