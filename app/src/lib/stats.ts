import type { HighTicketRule, Lead } from './leads'
import { isDemo, isWon } from './funnel'
import { isHigh, ticketValue } from './leads'
import { monthKeyOf } from './time'

export interface MonthStat { key: string; label: string; leads: number; demos: number; sales: number; ht: number; coll: number }

export function monthlyStats(leads: Lead[], rule: HighTicketRule, filter?: (l: Lead) => boolean): MonthStat[] {
  const map: Record<string, MonthStat> = {}
  for (const l of leads) {
    if (filter && !filter(l)) continue
    const { key, label } = monthKeyOf(l.created_utc)
    if (!map[key]) map[key] = { key, label, leads: 0, demos: 0, sales: 0, ht: 0, coll: 0 }
    map[key].leads++
    if (isDemo(l.stage)) map[key].demos++
    if (isWon(l.stage)) { map[key].sales++; map[key].coll += ticketValue(l) || 0 } // collections from closed (won) leads
    if (isHigh(l, rule)) map[key].ht++
  }
  return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1))
}

export const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')
export const specKey = (l: Lead) => (l.specialty || '').trim() || '(unspecified)'
export const monthKey = (l: Lead) => monthKeyOf(l.created_utc).key
