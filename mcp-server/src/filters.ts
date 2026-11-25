/**
 * The filter vocabulary shared by every lead-reading tool, so "SEO leads in
 * Dental since April" means the same thing to search, metrics, breakdown,
 * timeseries and export.
 */
import * as z from 'zod/v4'
import {
  displayName, effectiveNotes, fmtInZone, isDemoIn, isHigh, isLostIn, isWonIn,
  monthKeyOf, PK_ZONE, ticketValue,
  type FunnelConfig, type HighTicketRule, type Lead,
} from './domain.js'

export const WORKSPACE = z.string().min(1).max(64).optional()
  .describe("Workspace id or name, e.g. 'transcure' or 'macralytics'. Defaults to the server's default workspace; leads_list_workspaces shows them all.")

export const FILTER_SHAPE = {
  workspace: WORKSPACE,
  query: z.string().max(200).optional()
    .describe('Free text matched against name, practice, company, email, phone, specialty, notes and CRM comments.'),
  source: z.array(z.string().max(100)).max(50).optional()
    .describe('Keep only these lead sources, e.g. ["SEO"]. Exact, case-insensitive.'),
  stage: z.array(z.string().max(60)).max(30).optional()
    .describe('Keep only these funnel stages, e.g. ["Negotiation","Won"]. Stage names come from the workspace funnel.'),
  status: z.array(z.string().max(100)).max(50).optional()
    .describe('Keep only these raw CRM statuses, e.g. ["Agreement Sent"]. Exact, case-insensitive.'),
  specialty: z.string().max(100).optional().describe('Specialty contains this text, e.g. "Dental".'),
  owner: z.string().max(100).optional().describe('Lead owner contains this text.'),
  outcome: z.enum(['any', 'won', 'lost', 'open', 'reached_demo']).default('any')
    .describe("'won' / 'lost' use the workspace's terminal stages; 'open' is neither; 'reached_demo' is any stage flagged as demo-reached."),
  high_ticket: z.enum(['any', 'yes', 'no']).default('any')
    .describe("Apply the workspace's high-ticket rule (plus any per-lead override)."),
  min_collections: z.number().min(0).optional().describe('Minimum monthly collections (ticket value) in dollars.'),
  max_collections: z.number().min(0).optional().describe('Maximum monthly collections (ticket value) in dollars.'),
  has_email: z.boolean().optional().describe('true keeps only leads with an email address; false keeps only those without.'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Created on or after this date (Pakistan time), YYYY-MM-DD.'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Created on or before this date (Pakistan time), YYYY-MM-DD.'),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional()
    .describe("Created in this month (Pakistan time), e.g. '2026-04'. Shorthand for date_from/date_to."),
}

export type Filters = {
  query?: string
  source?: string[]
  stage?: string[]
  status?: string[]
  specialty?: string
  owner?: string
  outcome?: 'any' | 'won' | 'lost' | 'open' | 'reached_demo'
  high_ticket?: 'any' | 'yes' | 'no'
  min_collections?: number
  max_collections?: number
  has_email?: boolean
  date_from?: string
  date_to?: string
  month?: string
}

const lc = (s: string): string => s.trim().toLowerCase()
const pkDate = (iso: string | null): string => fmtInZone(iso, PK_ZONE, false)

export function applyFilters(leads: Lead[], f: Filters, funnel: FunnelConfig, rule: HighTicketRule): Lead[] {
  const sources = f.source?.map(lc)
  const stages = f.stage?.map(lc)
  const statuses = f.status?.map(lc)
  const from = f.month ? `${f.month}-01` : f.date_from
  const to = f.month ? `${f.month}-31` : f.date_to
  const q = f.query ? lc(f.query) : null

  return leads.filter((l) => {
    if (sources?.length && !sources.includes(lc(l.source || ''))) return false
    if (stages?.length && !stages.includes(lc(l.stage || ''))) return false
    if (statuses?.length && !statuses.includes(lc(l.status || ''))) return false
    if (f.specialty && !lc(l.specialty || '').includes(lc(f.specialty))) return false
    if (f.owner && !lc(l.lead_owner || '').includes(lc(f.owner))) return false

    switch (f.outcome) {
      case 'won': if (!isWonIn(funnel, l.stage)) return false; break
      case 'lost': if (!isLostIn(funnel, l.stage)) return false; break
      case 'open': if (isWonIn(funnel, l.stage) || isLostIn(funnel, l.stage)) return false; break
      case 'reached_demo': if (!isDemoIn(funnel, l.stage)) return false; break
      default: break
    }

    if (f.high_ticket === 'yes' && !isHigh(l, rule)) return false
    if (f.high_ticket === 'no' && isHigh(l, rule)) return false

    if (f.min_collections != null || f.max_collections != null) {
      const t = ticketValue(l)
      if (t == null) return false
      if (f.min_collections != null && t < f.min_collections) return false
      if (f.max_collections != null && t > f.max_collections) return false
    }

    if (f.has_email === true && !(l.email || '').trim()) return false
    if (f.has_email === false && (l.email || '').trim()) return false

    if (from || to) {
      const d = pkDate(l.created_utc)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }

    if (q) {
      const hay = lc([
        displayName(l), l.practice, l.company, l.email, l.phone, l.specialty,
        l.source, l.status, l.stage, l.lead_owner, effectiveNotes(l), l.message,
      ].filter(Boolean).join(' '))
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** A one-line echo of the filters in force, so a result is self-describing. */
export function describeFilters(f: Filters): string {
  const bits: string[] = []
  if (f.query) bits.push(`query "${f.query}"`)
  if (f.source?.length) bits.push(`source ${f.source.join('/')}`)
  if (f.stage?.length) bits.push(`stage ${f.stage.join('/')}`)
  if (f.status?.length) bits.push(`status ${f.status.join('/')}`)
  if (f.specialty) bits.push(`specialty ~ "${f.specialty}"`)
  if (f.owner) bits.push(`owner ~ "${f.owner}"`)
  if (f.outcome && f.outcome !== 'any') bits.push(f.outcome)
  if (f.high_ticket && f.high_ticket !== 'any') bits.push(`high-ticket ${f.high_ticket}`)
  if (f.min_collections != null) bits.push(`collections >= ${f.min_collections}`)
  if (f.max_collections != null) bits.push(`collections <= ${f.max_collections}`)
  if (f.has_email === true) bits.push('has email')
  if (f.has_email === false) bits.push('no email')
  if (f.month) bits.push(`month ${f.month}`)
  else if (f.date_from || f.date_to) bits.push(`${f.date_from ?? 'start'}..${f.date_to ?? 'now'}`)
  return bits.length ? bits.join(', ') : 'no filters'
}

export const DIMENSIONS = [
  'source', 'specialty', 'stage', 'status', 'owner', 'month', 'practice', 'physicians', 'high_ticket',
] as const
export type Dimension = (typeof DIMENSIONS)[number]

export function dimensionValue(l: Lead, d: Dimension, rule: HighTicketRule): string {
  switch (d) {
    case 'source': return (l.source || '').trim() || '(blank)'
    case 'specialty': return (l.specialty || '').trim() || '(unspecified)'
    case 'stage': return (l.stage || '').trim() || '(none)'
    case 'status': return (l.status || '').trim() || '(blank)'
    case 'owner': return (l.lead_owner || '').trim() || '(unassigned)'
    case 'month': return monthKeyOf(l.created_utc).key
    case 'practice': return (l.practice || '').trim() || '(unknown)'
    case 'physicians': return (l.physicians || '').trim() || '(unknown)'
    case 'high_ticket': return isHigh(l, rule) ? 'High ticket' : 'Standard'
  }
}
