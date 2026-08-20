import type { HighTicketRule } from './leads'
import type { Automation } from './api'

// A funnel stage, as configured per project. `reachedDemo` marks the stages that
// count toward the Leads->Demos ratio; `won` / `lost` mark terminal stages.
// `statuses` are the CRM status values (lowercased) that map onto this stage.
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
  /** Stage that enrols a lead in the follow-up sequence; null disables them. */
  follow_up_stage: string | null
  created_at: string
}

export const DEFAULT_PROJECT_ID = 'transcure'

// ── funnel helpers ───────────────────────────────────────────────────────────
// These replace the hardcoded FUNNEL_ORDER / STATUS_MAP, which assumed one
// pipeline. Every call now takes the project's own config.

export const stageNames = (f: FunnelConfig): string[] => f.stages.map((s) => s.name)

export function stageByName(f: FunnelConfig, name: string): FunnelStage | undefined {
  return f.stages.find((s) => s.name === name)
}

/** Map a CRM status onto a stage name. Falls back to the first stage. */
export function stageForIn(f: FunnelConfig, status: string | null | undefined): string {
  const key = (status || '').trim().toLowerCase()
  if (key) {
    const hit = f.stages.find((s) => s.statuses.includes(key))
    if (hit) return hit.name
  }
  return f.stages[0]?.name ?? 'Lead'
}

/**
 * Did this lead reach the demo milestone? Driven by the stage's own flag rather
 * than its index, so a project can put the milestone anywhere in its pipeline.
 */
export function isDemoIn(f: FunnelConfig, stage: string): boolean {
  return stageByName(f, stage)?.reachedDemo ?? false
}

export function isWonIn(f: FunnelConfig, stage: string): boolean {
  return stageByName(f, stage)?.won ?? false
}

export function isLostIn(f: FunnelConfig, stage: string): boolean {
  return stageByName(f, stage)?.lost ?? false
}

export function stageColor(f: FunnelConfig, stage: string): string {
  return stageByName(f, stage)?.color ?? '#94a3b8'
}

/** The stage a lost lead is moved to — used when auto-marking Lost. */
export function lostStageName(f: FunnelConfig): string {
  return f.stages.find((s) => s.lost)?.name ?? 'Lost'
}

/** A representative status to store alongside the lost stage. */
export function lostStatusFor(f: FunnelConfig): string {
  const s = f.stages.find((x) => x.lost)
  return s?.statuses[0] ?? 'Lost'
}

/**
 * Namespace an imported record_id so ids cannot collide between projects.
 * The original project has no prefix, so its existing rows keep their bare ids.
 */
export function scopedRecordId(p: Project, rawId: string): string {
  const id = rawId.trim()
  if (!p.record_id_prefix) return id
  const pre = p.record_id_prefix + ':'
  return id.startsWith(pre) ? id : pre + id
}

/** Strip the namespace for display and CSV export. */
export function bareRecordId(recordId: string): string {
  const i = recordId.indexOf(':')
  return i === -1 ? recordId : recordId.slice(i + 1)
}

// Used only as a last resort if the projects table has not been migrated yet,
// so the app still renders instead of crashing on a missing config.
export const FALLBACK_FUNNEL: FunnelConfig = {
  stages: [
    { name: 'Lead', color: '#94a3b8', reachedDemo: false, won: false, lost: false, statuses: [] },
    { name: 'Engaged', color: '#3b82f6', reachedDemo: false, won: false, lost: false, statuses: ['contacted', 'attempted to contact', 'follow up', 'contact in future'] },
    { name: 'Demo', color: '#6366f1', reachedDemo: true, won: false, lost: false, statuses: ['demo scheduled', 'demo completed', 'demo done'] },
    { name: 'Audit', color: '#16a34a', reachedDemo: true, won: false, lost: false, statuses: ['under audit'] },
    { name: 'Negotiation', color: '#0891b2', reachedDemo: true, won: false, lost: false, statuses: ['agreement sent', 'contract sent'] },
    { name: 'Won', color: '#15803d', reachedDemo: true, won: true, lost: false, statuses: ['won lead', 'won'] },
    { name: 'Lost', color: '#dc2626', reachedDemo: false, won: false, lost: true, statuses: ['lost lead', 'lost / contract lead', 'not-qualified', 'not qualified', 'junk lead'] },
  ],
}

export const FALLBACK_PROJECT: Project = {
  id: DEFAULT_PROJECT_ID,
  name: 'Transcure',
  sort_order: 10,
  record_id_prefix: null,
  logo_data_url: null,
  high_ticket_rule: { op: 'gte', value: 50000 },
  default_charge_pct: 5,
  follow_up_manager_email: null,
  follow_up_automation: { enabled: true, digestHour: 9, timezone: 'Asia/Karachi', graceDays: 7, remindOverdueDaily: true },
  funnel: FALLBACK_FUNNEL,
  follow_up_stage: 'Negotiation',
  created_at: new Date(0).toISOString(),
}
