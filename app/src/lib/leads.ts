import { parseSourceTime } from './time'
import { stageFor } from './funnel'

// A lead as stored in / read from the DB.
export interface Lead {
  record_id: string
  lead_owner: string | null
  company: string | null
  first_name: string | null
  last_name: string | null
  lead_name: string | null
  email: string | null
  phone: string | null
  source: string
  status: string
  stage: string
  tag: string | null
  specialty: string | null
  practice: string | null
  physicians: string | null
  monthly_collections: number | null
  first_page: string | null
  referrer: string | null
  message: string | null
  comments: string | null
  phase: string | null
  created_utc: string | null
  modified_utc: string | null
  raw: Record<string, unknown> | null
  // manual enrichment
  manual_ticket: number | null
  manual_high: boolean | null
  manual_notes: string | null
}

// The CRM-owned subset that an import is allowed to write (no manual_* fields).
export type CrmLead = Omit<Lead, 'manual_ticket' | 'manual_high' | 'manual_notes'>

export function num(v: unknown): number | null {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

// Flatten Zoho's HTML Comments into readable text.
export function stripHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/<\s*(br|\/p|\/li|\/div|\/tr)\s*\/?>/gi, ' • ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#3?9;|&apos;/gi, "'")
    .replace(/(\s*•\s*)+/g, ' • ').replace(/\s+/g, ' ').replace(/^\s*•\s*/, '').trim()
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
// Undo Excel date-mangling of ranges like "2-5" -> "5-Feb".
export function fixRange(v: string | null | undefined): string {
  if (!v) return ''
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})$/)
  if (m && MON[m[2].toLowerCase()]) return `${MON[m[2].toLowerCase()]}-${+m[1]}`
  m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/)
  if (m && MON[m[1].toLowerCase()]) return `${MON[m[1].toLowerCase()]}-${+m[2]}`
  return s
}

const g = (row: Record<string, string>, k: string) => (row[k] ?? '').trim() || null

// Map a parsed CSV row to the CRM-owned columns for upsert.
export function csvRowToLead(row: Record<string, string>): CrmLead {
  const created = parseSourceTime(row['Created Time'])
  const modified = parseSourceTime(row['Modified Time'])
  const name = (row['Lead Name'] || `${row['First Name'] || ''} ${row['Last Name'] || ''}`).trim() || null
  const status = row['Lead Status'] || ''
  return {
    record_id: (row['Record Id'] || '').trim(),
    lead_owner: g(row, 'Lead Owner'),
    company: g(row, 'Company'),
    first_name: g(row, 'First Name'),
    last_name: g(row, 'Last Name'),
    lead_name: name,
    email: g(row, 'Email') || g(row, 'Secondary Email'),
    phone: g(row, 'Phone') || g(row, 'Mobile'),
    source: (row['Lead Source'] || '').trim() || '(blank)',
    status,
    stage: stageFor(status),
    tag: g(row, 'Tag'),
    specialty: g(row, 'Specialty') || g(row, 'Industry'),
    practice: g(row, 'Practice Name') || g(row, 'Company'),
    physicians: fixRange(row['Number of Physicians']),
    monthly_collections: num(row['Monthly Collections']),
    first_page: g(row, 'First Page Visited'),
    referrer: g(row, 'Referrer'),
    message: g(row, 'Message') || g(row, 'Description'),
    comments: stripHtml(row['Comments']),
    phase: g(row, 'Lead Phases'),
    created_utc: created ? created.toISOString() : null,
    modified_utc: modified ? modified.toISOString() : null,
    raw: row,
  }
}

// ---- derived values (used everywhere in the UI) ----
export function ticketValue(l: Lead): number | null {
  if (l.manual_ticket != null) return l.manual_ticket
  return l.monthly_collections
}
// User-definable high-ticket rule, applied to a lead's ticket value.
export interface HighTicketRule {
  op: 'gte' | 'gt' | 'lte' | 'lt' | 'between'
  value: number
  value2?: number | null
}
export const DEFAULT_RULE: HighTicketRule = { op: 'gte', value: 50000 }

export function ruleMatches(v: number | null, rule: HighTicketRule): boolean {
  if (v == null) return false
  switch (rule.op) {
    case 'gte': return v >= rule.value
    case 'gt': return v > rule.value
    case 'lte': return v <= rule.value
    case 'lt': return v < rule.value
    case 'between': return v >= rule.value && v <= (rule.value2 ?? Infinity)
    default: return false
  }
}

export function isHigh(l: Lead, rule: HighTicketRule): boolean {
  if (l.manual_high === true) return true   // manual override wins
  if (l.manual_high === false) return false
  return ruleMatches(ticketValue(l), rule)
}

const OP_LABEL: Record<HighTicketRule['op'], string> = { gte: '≥', gt: '>', lte: '≤', lt: '<', between: 'between' }
export function ruleLabel(rule: HighTicketRule): string {
  if (rule.op === 'between') return `Monthly Collections ${fmtMoney(rule.value)} – ${fmtMoney(rule.value2 ?? 0)}`
  return `Monthly Collections ${OP_LABEL[rule.op]} ${fmtMoney(rule.value)}`
}
export function effectiveNotes(l: Lead): string {
  if (l.manual_notes != null && l.manual_notes.trim() !== '') return l.manual_notes
  return l.comments || ''
}
export function displayName(l: Lead): string {
  return l.lead_name || `${l.first_name || ''} ${l.last_name || ''}`.trim() || '(no name)'
}
export function fmtMoney(n: number | null | undefined): string {
  return n == null ? '' : '$' + Math.round(n).toLocaleString('en-US')
}
