/**
 * Domain types and derived values, mirrored from the web app.
 *
 * Kept deliberately identical to app/src/lib/{leads,projects,followups,time}.ts
 * so a number Claude reports here matches the number on the dashboard. If the
 * app's rules change, change them here too — the two are a pair.
 */

export const PK_ZONE = 'Asia/Karachi'
export const SRC_ZONE = 'America/Chicago'
export const DEFAULT_CHARGE_PCT = 5

// ── leads ────────────────────────────────────────────────────────────────────

export interface Lead {
  record_id: string
  project_id: string
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
  manual_ticket: number | null
  manual_high: boolean | null
  manual_notes: string | null
  manual_source_medium: string | null
  manual_first_landing: string | null
  manual_second_page: string | null
  manual_submit_page: string | null
  manual_search_query: string | null
  manual_recording: string | null
  manual_charge_pct: number | null
  manual_revenue_month: string | null
  manual_updated_at?: string | null
}

export const MANUAL_FIELDS = [
  'manual_ticket', 'manual_high', 'manual_notes', 'manual_source_medium',
  'manual_first_landing', 'manual_second_page', 'manual_submit_page',
  'manual_search_query', 'manual_recording', 'manual_charge_pct', 'manual_revenue_month',
] as const
export type ManualField = (typeof MANUAL_FIELDS)[number]
export type ManualPatch = Partial<Pick<Lead, ManualField>>

/** Columns a search needs. Excludes `raw`, which is a whole CSV row per lead. */
export const LEAD_COLUMNS =
  'record_id, project_id, lead_owner, company, first_name, last_name, lead_name, email, phone, ' +
  'source, status, stage, tag, specialty, practice, physicians, monthly_collections, first_page, ' +
  'referrer, message, comments, phase, created_utc, modified_utc, manual_ticket, manual_high, ' +
  'manual_notes, manual_source_medium, manual_first_landing, manual_second_page, manual_submit_page, ' +
  'manual_search_query, manual_recording, manual_charge_pct, manual_revenue_month, manual_updated_at'

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

export const ticketValue = (l: Lead): number | null =>
  l.manual_ticket != null ? Number(l.manual_ticket) : l.monthly_collections != null ? Number(l.monthly_collections) : null

export const chargePct = (l: Lead, projectDefault = DEFAULT_CHARGE_PCT): number =>
  l.manual_charge_pct != null ? Number(l.manual_charge_pct) : projectDefault

export function leadRevenue(l: Lead, projectDefault = DEFAULT_CHARGE_PCT): number {
  const t = ticketValue(l)
  return t == null ? 0 : (t * chargePct(l, projectDefault)) / 100
}

export function isHigh(l: Lead, rule: HighTicketRule): boolean {
  if (l.manual_high === true) return true
  if (l.manual_high === false) return false
  return ruleMatches(ticketValue(l), rule)
}

export const displayName = (l: Lead): string =>
  l.lead_name || `${l.first_name || ''} ${l.last_name || ''}`.trim() || '(no name)'

export const effectiveNotes = (l: Lead): string =>
  l.manual_notes != null && l.manual_notes.trim() !== '' ? l.manual_notes : l.comments || ''

export const ruleLabel = (r: HighTicketRule): string => {
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  const op: Record<HighTicketRule['op'], string> = { gte: '>=', gt: '>', lte: '<=', lt: '<', between: 'between' }
  return r.op === 'between'
    ? `Monthly Collections ${money(r.value)} - ${money(r.value2 ?? 0)}`
    : `Monthly Collections ${op[r.op]} ${money(r.value)}`
}

// ── projects / funnel ────────────────────────────────────────────────────────

export interface FunnelStage {
  name: string
  color: string
  reachedDemo: boolean
  won: boolean
  lost: boolean
  statuses: string[]
}
export interface FunnelConfig {
  stages: FunnelStage[]
  /**
   * CRM statuses (lowercased) that count toward Demos even though their stage
   * is not demo-reached — a lead lost after a demo still had the demo. They
   * stay on their own stage; only the Demos count changes.
   */
  demoStatuses?: string[]
}

export interface Automation {
  enabled: boolean
  digestHour: number
  timezone: string
  graceDays: number
  remindOverdueDaily: boolean
}

export interface Project {
  id: string
  name: string
  sort_order: number
  record_id_prefix: string | null
  logo_data_url: string | null
  high_ticket_rule: HighTicketRule
  default_charge_pct: number
  follow_up_manager_email: string | null
  follow_up_automation: Automation
  funnel: FunnelConfig
  follow_up_stage: string | null
  created_at: string
}

export const stageByName = (f: FunnelConfig, name: string): FunnelStage | undefined =>
  f.stages.find((s) => s.name === name)

export function stageForIn(f: FunnelConfig, status: string | null | undefined): string {
  const key = (status || '').trim().toLowerCase()
  if (key) {
    const hit = f.stages.find((s) => s.statuses.includes(key))
    if (hit) return hit.name
  }
  return f.stages[0]?.name ?? 'Lead'
}

/** True when a status matched no stage and fell back to the first one. */
export function isUnmappedStatus(f: FunnelConfig, status: string | null | undefined): boolean {
  const key = (status || '').trim().toLowerCase()
  if (!key) return false
  return !f.stages.some((s) => s.statuses.includes(key))
}

/**
 * Did this lead reach the demo milestone?
 *
 * Either its stage is flagged demo-reached, or its CRM status is one the
 * workspace lists in `demoStatuses`. Takes the status rather than inferring it
 * so a lead lost after a demo still counts, which is what the dashboard does.
 */
export function isDemoIn(f: FunnelConfig, stage: string, status?: string | null): boolean {
  if (stageByName(f, stage)?.reachedDemo) return true
  const key = (status || '').trim().toLowerCase()
  return !!key && (f.demoStatuses ?? []).includes(key)
}
export const isWonIn = (f: FunnelConfig, stage: string): boolean => stageByName(f, stage)?.won ?? false
export const isLostIn = (f: FunnelConfig, stage: string): boolean => stageByName(f, stage)?.lost ?? false
export const lostStageName = (f: FunnelConfig): string => f.stages.find((s) => s.lost)?.name ?? 'Lost'
export const lostStatusFor = (f: FunnelConfig): string => f.stages.find((x) => x.lost)?.statuses[0] ?? 'Lost'

/** Namespace a record id so ids cannot collide between workspaces. */
export function scopedRecordId(p: Pick<Project, 'record_id_prefix'>, rawId: string): string {
  const id = rawId.trim()
  if (!p.record_id_prefix) return id
  const pre = p.record_id_prefix + ':'
  return id.startsWith(pre) ? id : pre + id
}

export function bareRecordId(recordId: string): string {
  const i = recordId.indexOf(':')
  return i === -1 ? recordId : recordId.slice(i + 1)
}

// ── follow-ups ───────────────────────────────────────────────────────────────

export const STEP_CHANNELS: readonly (readonly string[])[] = [
  ['Email', 'SMS'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call', 'LinkedIn'],
]
export const ALL_CHANNELS = ['Email', 'SMS', 'Call', 'LinkedIn'] as const

export interface FollowUpSequence {
  id: string
  project_id: string
  lead_record_id: string
  manager_email: string | null
  started_at: string
  started_by: string | null
  status: 'active' | 'won' | 'lost'
  created_at: string
  /**
   * A note about this lead's follow-up as a whole, as opposed to
   * FollowUpStep.notes which belongs to one week. Optional because a database
   * without migration 008 simply does not return it.
   */
  notes?: string | null
}

export interface FollowUpStep {
  id: string
  sequence_id: string
  step_number: number
  scheduled_date: string
  channels: string[]
  completed_channels: string[] | null
  status: 'pending' | 'done' | 'skipped'
  completed_at: string | null
  notes: string | null
}

export function pendingChannels(step: FollowUpStep): string[] {
  const done = new Set(step.completed_channels ?? [])
  return (step.channels ?? []).filter((c) => !done.has(c))
}
export const stepComplete = (step: FollowUpStep): boolean => pendingChannels(step).length === 0

export function effectiveEmail(seq: FollowUpSequence, projectDefault: string): string {
  const own = (seq.manager_email ?? '').trim()
  return own !== '' ? own : (projectDefault || '').trim()
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10)

export function defaultDates(startIso: string): string[] {
  const base = new Date(startIso + 'T12:00:00')
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

export const nextPending = (steps: FollowUpStep[]): FollowUpStep | null =>
  [...steps].sort((a, b) => a.step_number - b.step_number).find((s) => !stepComplete(s)) ?? null

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z')
  const b = Date.parse(toIso + 'T00:00:00Z')
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

// ── time ─────────────────────────────────────────────────────────────────────

function parts(date: Date, timeZone: string, withTime: boolean): Record<string, string> {
  const opt: Intl.DateTimeFormatOptions = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }
  if (withTime) { opt.hour = '2-digit'; opt.minute = '2-digit'; opt.hourCycle = 'h23' }
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-GB', opt).formatToParts(date)) p[part.type] = part.value
  return p
}

const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export function fmtInZone(value: string | null | undefined, timeZone = PK_ZONE, withTime = true): string {
  const d = toDate(value)
  if (!d) return ''
  const p = parts(d, timeZone, withTime)
  return `${p.year}-${p.month}-${p.day}` + (withTime ? ` ${p.hour}:${p.minute}` : '')
}

export function monthKeyOf(value: string | null | undefined, timeZone = PK_ZONE): { key: string; label: string } {
  const d = toDate(value)
  if (!d) return { key: 'unknown', label: 'Unknown date' }
  const p = parts(d, timeZone, false)
  return {
    key: `${p.year}-${p.month}`,
    label: new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long' }).format(d),
  }
}

export function labelForKey(key: string): string {
  if (key === 'unknown') return 'Unknown date'
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
}

/** Interpret a CRM time string as wall-clock in US Central, return the UTC instant. */
export function parseSourceTime(str: string | null | undefined): Date | null {
  if (!str) return null
  const s = String(str).trim()
  let Y: number, Mo: number, D: number, H: number, Mi: number, S = 0
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
  if (m) {
    Y = +m[1]; Mo = +m[2]; D = +m[3]; H = +m[4]; Mi = +m[5]; S = +(m[6] || 0)
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*([AP]M)?/i)
    if (!m) return null
    Mo = +m[1]; D = +m[2]; Y = +m[3]; H = +m[4]; Mi = +m[5]; S = +(m[6] || 0)
    if (Y < 100) Y += 2000
    const ap = m[7]
    if (ap) { const pm = /p/i.test(ap); if (pm && H < 12) H += 12; if (!pm && H === 12) H = 0 }
  }
  const naive = Date.UTC(Y, Mo - 1, D, H, Mi, S)
  const offAt = (d: Date): number => {
    const p = parts(d, SRC_ZONE, true)
    const secs = new Intl.DateTimeFormat('en-GB', { timeZone: SRC_ZONE, second: '2-digit' }).format(d)
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +secs) - d.getTime()
  }
  let utc = naive - offAt(new Date(naive))
  utc = naive - offAt(new Date(utc)) // refine across DST edges
  return new Date(utc)
}

export const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

// The separator the web app uses for flattened block tags. Built from its code
// point so the character survives editing, and kept identical to
// app/src/lib/leads.ts: the same CSV imported here and there must store the
// same text.
const BULLET = String.fromCharCode(0x2022)

export function stripHtml(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/<\s*(br|\/p|\/li|\/div|\/tr)\s*\/?>/gi, ` ${BULLET} `)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#3?9;|&apos;/gi, "'")
    .replace(new RegExp(`(\\s*${BULLET}\\s*)+`, 'g'), ` ${BULLET} `)
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`^\\s*${BULLET}\\s*`), '')
    .trim()
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
/** Undo Excel date-mangling of ranges like "2-5" -> "5-Feb". */
export function fixRange(v: string | null | undefined): string {
  if (!v) return ''
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})$/)
  if (m && MON[m[2].toLowerCase()]) return `${MON[m[2].toLowerCase()]}-${+m[1]}`
  m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/)
  if (m && MON[m[1].toLowerCase()]) return `${MON[m[1].toLowerCase()]}-${+m[2]}`
  return s
}

export const fmtMoney = (n: number | null | undefined): string =>
  n == null ? '-' : '$' + Math.round(n).toLocaleString('en-US')

export const pctStr = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')
