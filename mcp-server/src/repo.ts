/**
 * Data access. Every database read and write in this server goes through here.
 *
 * There is deliberately no "run SQL" escape hatch: an MCP tool that forwards
 * arbitrary SQL hands whoever can influence the conversation the whole database,
 * and no amount of prompt wording contains that. Tools compose these typed
 * functions instead.
 */
import type { PostgrestError } from '@supabase/supabase-js'
import { client, currentUserId, settings } from './supabase.js'
import {
  DEFAULT_RULE, LEAD_COLUMNS,
  type Automation, type FollowUpSequence, type FollowUpStep, type FunnelConfig,
  type Lead, type ManualPatch, type Project,
} from './domain.js'

/** True when PostgREST says a column is missing (database not migrated yet). */
const isMissingColumn = (e: PostgrestError | null): boolean =>
  !!e && (e.code === '42703' || /column .* does not exist|does not exist on/i.test(e.message ?? ''))

/** True when PostgREST says the whole table or view is missing. */
const isMissingTable = (e: PostgrestError | null): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(e.message ?? ''))

export class RepoError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(hint ? `${message} (${hint})` : message)
  }
}

function fail(e: PostgrestError, what: string): never {
  if (isMissingTable(e)) {
    throw new RepoError(
      `The ${what} table does not exist in this Supabase project.`,
      'apply the migrations in app/supabase/migrations/ — 006_projects.sql adds the workspace columns',
    )
  }
  if (e.code === '42501' || /permission denied|row-level security/i.test(e.message ?? '')) {
    throw new RepoError(
      `The signed-in user is not allowed to do that to ${what}.`,
      'Row Level Security refused the request; check the account has tracker access',
    )
  }
  throw new RepoError(`${what}: ${e.message}`)
}

// ── projects ─────────────────────────────────────────────────────────────────

const FALLBACK_FUNNEL: FunnelConfig = {
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

const FALLBACK_PROJECT: Project = {
  id: 'transcure',
  name: 'Transcure',
  sort_order: 10,
  record_id_prefix: null,
  logo_data_url: null,
  high_ticket_rule: DEFAULT_RULE,
  default_charge_pct: 5,
  follow_up_manager_email: null,
  follow_up_automation: { enabled: true, digestHour: 9, timezone: 'Asia/Karachi', graceDays: 7, remindOverdueDaily: true },
  funnel: FALLBACK_FUNNEL,
  follow_up_stage: 'Negotiation',
  created_at: new Date(0).toISOString(),
}

let projectCache: { at: number; rows: Project[] } | null = null
const PROJECT_TTL_MS = 30_000

export async function listProjects(force = false): Promise<Project[]> {
  if (!force && projectCache && Date.now() - projectCache.at < PROJECT_TTL_MS) return projectCache.rows
  const sb = await client()
  const { data, error } = await sb.from('projects').select('*').order('sort_order')
  if (error && !isMissingTable(error)) fail(error, 'projects')
  // Before migration 006 there is no projects table; the single original
  // workspace still has to work, so synthesise it rather than failing.
  const rows = (!error && data?.length ? (data as Project[]) : [FALLBACK_PROJECT])
  projectCache = { at: Date.now(), rows }
  return rows
}

export async function getProject(id?: string): Promise<Project> {
  const wanted = (id ?? settings().defaultProject).trim().toLowerCase()
  const all = await listProjects()
  const hit = all.find((p) => p.id.toLowerCase() === wanted) ?? all.find((p) => p.name.toLowerCase() === wanted)
  if (hit) return hit
  throw new RepoError(
    `No workspace "${id}".`,
    `known workspaces: ${all.map((p) => p.id).join(', ')}`,
  )
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('projects').update(patch).eq('id', id)
  if (error) fail(error, 'projects')
  projectCache = null
  leadCache.clear()
}

// ── leads ────────────────────────────────────────────────────────────────────

const leadCache = new Map<string, { at: number; rows: Lead[] }>()
const LEAD_TTL_MS = 20_000

export function invalidateLeads(projectId?: string): void {
  if (projectId) leadCache.delete(projectId)
  else leadCache.clear()
}

/**
 * Every lead in one workspace, paged past PostgREST's 1000-row cap.
 *
 * Cached briefly: the analysis tools each need the full set, and a single
 * question can trigger several of them. The cache is dropped on every write so
 * a read after an edit never shows stale data.
 */
export async function fetchLeads(projectId: string, force = false): Promise<Lead[]> {
  const hit = leadCache.get(projectId)
  if (!force && hit && Date.now() - hit.at < LEAD_TTL_MS) return hit.rows

  const sb = await client()
  const all: Lead[] = []
  const size = 1000
  let scoped = true
  for (let from = 0; ; from += size) {
    let q = sb.from('leads').select(LEAD_COLUMNS)
    if (scoped) q = q.eq('project_id', projectId)
    const { data, error } = await q
      .order('created_utc', { ascending: false, nullsFirst: false })
      .range(from, from + size - 1)
    if (error) {
      if (scoped && isMissingColumn(error)) {
        // Pre-migration database: no project_id column. Retry unscoped.
        scoped = false
        from = -size
        all.length = 0
        continue
      }
      fail(error, 'leads')
    }
    const rows = (data ?? []) as unknown as Lead[]
    all.push(...rows)
    if (rows.length < size) break
  }
  leadCache.set(projectId, { at: Date.now(), rows: all })
  return all
}

export async function getLead(recordId: string): Promise<Lead | null> {
  const sb = await client()
  const { data, error } = await sb.from('leads').select(LEAD_COLUMNS).eq('record_id', recordId).maybeSingle()
  if (error) fail(error, 'leads')
  return (data as unknown as Lead) ?? null
}

export async function saveManual(recordId: string, patch: ManualPatch): Promise<void> {
  const sb = await client()
  const { error } = await sb
    .from('leads')
    .update({ ...patch, manual_updated_by: await currentUserId(), manual_updated_at: new Date().toISOString() })
    .eq('record_id', recordId)
  if (error) fail(error, 'leads')
  invalidateLeads()
}

export async function updateLeadStageAndStatus(recordId: string, status: string, stage: string): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('leads').update({ status, stage }).eq('record_id', recordId)
  if (error) fail(error, 'leads')
  invalidateLeads()
}

export async function createLead(lead: Partial<Lead>): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('leads').insert(lead)
  if (error) {
    if (error.code === '23505') {
      throw new RepoError(
        `A lead with record_id "${lead.record_id}" already exists.`,
        'use leads_update to change it, or pick a different record_id',
      )
    }
    fail(error, 'leads')
  }
  invalidateLeads()
}

export async function deleteLead(recordId: string): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('leads').delete().eq('record_id', recordId)
  if (error) fail(error, 'leads')
  invalidateLeads()
}

/** Recompute every lead's stage in a workspace from its stored CRM status. */
export async function remapStages(projectId: string, stageOf: (status: string | null) => string): Promise<number> {
  const sb = await client()
  const leads = await fetchLeads(projectId, true)
  const byStage = new Map<string, string[]>()
  for (const l of leads) {
    const want = stageOf(l.status)
    if (want === l.stage) continue
    const arr = byStage.get(want) ?? []
    arr.push(l.record_id)
    byStage.set(want, arr)
  }
  let changed = 0
  for (const [stage, ids] of byStage) {
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500)
      const { error } = await sb.from('leads').update({ stage }).in('record_id', slice)
      if (error) fail(error, 'leads')
      changed += slice.length
    }
  }
  invalidateLeads(projectId)
  return changed
}

// ── imports ──────────────────────────────────────────────────────────────────

export interface ImportResult { total: number; inserted: number; updated: number }

const MANUAL_COLS =
  'manual_ticket, manual_high, manual_notes, manual_source_medium, manual_first_landing, ' +
  'manual_second_page, manual_submit_page, manual_search_query, manual_recording, ' +
  'manual_charge_pct, manual_revenue_month'

const BLANK_MANUAL: ManualPatch = {
  manual_ticket: null, manual_high: null, manual_notes: null, manual_source_medium: null,
  manual_first_landing: null, manual_second_page: null, manual_submit_page: null,
  manual_search_query: null, manual_recording: null, manual_charge_pct: null, manual_revenue_month: null,
}

/**
 * Upsert CRM rows by record_id, preserving in-app enrichment.
 *
 * Mirrors the web app: existing manual_* values are read back and merged into
 * the payload, so an import refreshes CRM columns and can never silently wipe
 * work someone typed into the tool.
 */
export async function importLeads(
  rows: Record<string, unknown>[],
  fileName: string,
  projectId: string,
): Promise<ImportResult> {
  const sb = await client()
  const ids = rows.map((r) => String(r.record_id ?? '')).filter(Boolean)
  const manualById = new Map<string, ManualPatch>()
  for (let i = 0; i < ids.length; i += 1000) {
    const slice = ids.slice(i, i + 1000)
    const { data, error } = await sb.from('leads').select(`record_id, ${MANUAL_COLS}`).in('record_id', slice)
    if (error) fail(error, 'leads')
    for (const d of data ?? []) {
      const row = d as unknown as { record_id: string } & ManualPatch
      manualById.set(row.record_id, row)
    }
  }
  const inserted = ids.filter((id) => !manualById.has(id)).length
  const updated = ids.length - inserted

  const merged = rows.map((r) => ({
    ...r,
    project_id: projectId,
    ...BLANK_MANUAL,
    ...(manualById.get(String(r.record_id)) ?? {}),
  }))

  for (let i = 0; i < merged.length; i += 500) {
    const { error } = await sb.from('leads').upsert(merged.slice(i, i + 500), { onConflict: 'record_id' })
    if (error) fail(error, 'leads')
  }

  const meta = {
    file_name: fileName,
    uploaded_by: await currentUserId(),
    rows_total: rows.length,
    rows_inserted: inserted,
    rows_updated: updated,
    project_id: projectId,
  }
  // Best-effort history: logging must never fail the import itself.
  try {
    const { error } = await sb.from('import_batches').insert({ ...meta, rows })
    if (error) await sb.from('import_batches').insert(meta)
  } catch { /* ignore */ }

  invalidateLeads(projectId)
  return { total: rows.length, inserted, updated }
}

export interface ImportBatch {
  id: string
  file_name: string | null
  uploaded_at: string
  rows_total: number | null
  rows_inserted: number | null
  rows_updated: number | null
}

export async function fetchImportBatches(projectId: string, limit = 50): Promise<ImportBatch[]> {
  const sb = await client()
  const cols = 'id, file_name, uploaded_at, rows_total, rows_inserted, rows_updated'
  const { data, error } = await sb
    .from('import_batches').select(cols).eq('project_id', projectId)
    .order('uploaded_at', { ascending: false }).limit(limit)
  if (!error) return (data ?? []) as unknown as ImportBatch[]
  if (!isMissingColumn(error)) fail(error, 'import_batches')
  const { data: d2, error: e2 } = await sb
    .from('import_batches').select(cols).order('uploaded_at', { ascending: false }).limit(limit)
  if (e2) fail(e2, 'import_batches')
  return (d2 ?? []) as unknown as ImportBatch[]
}

export async function reapplyBatch(id: string): Promise<ImportResult & { fileName: string; projectId: string }> {
  const sb = await client()
  const { data, error } = await sb
    .from('import_batches').select('file_name, rows, project_id').eq('id', id).maybeSingle()
  if (error) fail(error, 'import_batches')
  if (!data) throw new RepoError(`No import batch with id "${id}".`, 'list them with leads_activity')
  const row = data as { file_name: string | null; rows: Record<string, unknown>[] | null; project_id?: string }
  const rows = row.rows ?? []
  if (!rows.length) {
    throw new RepoError('That import has no stored rows to re-apply.', 'it predates row-level import history')
  }
  const projectId = row.project_id ?? settings().defaultProject
  const result = await importLeads(rows, `Re-applied: ${row.file_name ?? 'import'}`, projectId)
  return { ...result, fileName: row.file_name ?? 'import', projectId }
}

// ── follow-ups ───────────────────────────────────────────────────────────────

export async function fetchSequences(projectId: string): Promise<FollowUpSequence[]> {
  const sb = await client()
  const { data, error } = await sb
    .from('follow_up_sequences').select('*').eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!error) return (data ?? []) as FollowUpSequence[]
  if (!isMissingColumn(error)) fail(error, 'follow_up_sequences')
  const { data: d2, error: e2 } = await sb
    .from('follow_up_sequences').select('*').order('created_at', { ascending: false })
  if (e2) fail(e2, 'follow_up_sequences')
  return (d2 ?? []) as FollowUpSequence[]
}

export async function fetchStepsFor(sequenceIds: string[]): Promise<FollowUpStep[]> {
  if (!sequenceIds.length) return []
  const sb = await client()
  const all: FollowUpStep[] = []
  for (let i = 0; i < sequenceIds.length; i += 500) {
    const { data, error } = await sb
      .from('follow_up_steps').select('*')
      .in('sequence_id', sequenceIds.slice(i, i + 500))
      .order('step_number')
    if (error) fail(error, 'follow_up_steps')
    all.push(...((data ?? []) as FollowUpStep[]))
  }
  return all
}

export async function createSequence(
  leadRecordId: string,
  managerEmail: string | null,
  steps: { scheduled_date: string; channels: string[] }[],
  projectId: string,
): Promise<FollowUpSequence> {
  const sb = await client()
  const { data: seq, error } = await sb
    .from('follow_up_sequences')
    .insert({ lead_record_id: leadRecordId, manager_email: managerEmail, started_by: await currentUserId(), project_id: projectId })
    .select().single()
  if (error) {
    if (error.code === '23505') {
      throw new RepoError(`That lead already has a follow-up sequence.`, 'use action "reschedule" or "complete_channel" on it instead')
    }
    fail(error, 'follow_up_sequences')
  }
  const row = seq as FollowUpSequence
  const stepRows = steps.map((s, i) => ({
    sequence_id: row.id, step_number: i + 1, scheduled_date: s.scheduled_date, channels: s.channels,
  }))
  const { error: se } = await sb.from('follow_up_steps').insert(stepRows)
  if (se) fail(se, 'follow_up_steps')
  return row
}

/** Enrol every supplied lead that has no sequence yet. Returns how many were created. */
export async function provisionSequences(
  leadIds: string[],
  stepsFor: (leadId: string) => { scheduled_date: string; channels: string[] }[],
  projectId: string,
): Promise<number> {
  if (!leadIds.length) return 0
  const sb = await client()
  const uid = await currentUserId()
  const { data: created, error } = await sb
    .from('follow_up_sequences')
    .upsert(
      leadIds.map((id) => ({ lead_record_id: id, manager_email: null, started_by: uid, project_id: projectId })),
      { onConflict: 'lead_record_id', ignoreDuplicates: true },
    )
    .select()
  if (error) fail(error, 'follow_up_sequences')
  const rows = (created ?? []) as FollowUpSequence[]
  const stepRows = rows.flatMap((seq) =>
    stepsFor(seq.lead_record_id).map((s, i) => ({
      sequence_id: seq.id, step_number: i + 1, scheduled_date: s.scheduled_date, channels: s.channels,
    })),
  )
  if (stepRows.length) {
    const { error: se } = await sb.from('follow_up_steps').insert(stepRows)
    if (se) fail(se, 'follow_up_steps')
  }
  return rows.length
}

export async function setStepChannels(stepId: string, completed: string[], all: string[]): Promise<void> {
  const sb = await client()
  const done = all.every((c) => completed.includes(c))
  const { error } = await sb.from('follow_up_steps').update({
    completed_channels: completed,
    status: done ? 'done' : 'pending',
    completed_at: done ? new Date().toISOString() : null,
  }).eq('id', stepId)
  if (error) fail(error, 'follow_up_steps')
}

export async function updateStepDate(stepId: string, date: string): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('follow_up_steps').update({ scheduled_date: date }).eq('id', stepId)
  if (error) fail(error, 'follow_up_steps')
}

export async function markSequenceStatus(sequenceId: string, status: 'active' | 'won' | 'lost'): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('follow_up_sequences').update({ status }).eq('id', sequenceId)
  if (error) fail(error, 'follow_up_sequences')
}

export async function updateSequenceEmail(sequenceId: string, email: string | null): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('follow_up_sequences').update({ manager_email: email }).eq('id', sequenceId)
  if (error) fail(error, 'follow_up_sequences')
}

/** A note about the whole sequence. null clears it. */
export async function updateSequenceNotes(sequenceId: string, notes: string | null): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('follow_up_sequences').update({ notes }).eq('id', sequenceId)
  if (error) {
    if (isMissingColumn(error)) {
      throw new RepoError(
        'Sequence notes are not available in this database yet.',
        'apply app/supabase/migrations/008_follow_up_notes.sql',
      )
    }
    fail(error, 'follow_up_sequences')
  }
}

/** A note against one week of a sequence. null clears it. */
export async function updateStepNotes(stepId: string, notes: string | null): Promise<void> {
  const sb = await client()
  const { error } = await sb.from('follow_up_steps').update({ notes }).eq('id', stepId)
  if (error) fail(error, 'follow_up_steps')
}

// ── reminders ────────────────────────────────────────────────────────────────

export interface ReminderLog {
  id: string
  sent_on: string
  recipient: string
  kind: string
  subject: string | null
  step_count: number
  status: string
  error: string | null
  created_at: string
  project_id?: string | null
}

export async function fetchReminderLog(limit = 25): Promise<ReminderLog[]> {
  const sb = await client()
  const { data, error } = await sb
    .from('follow_up_reminders').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingTable(error)) return []
    fail(error, 'follow_up_reminders')
  }
  return (data ?? []) as ReminderLog[]
}

export interface ReminderRunResult {
  ok: boolean
  error?: string
  missingSecrets?: string[]
  tested?: string
  today?: string
  dryRun?: boolean
  digestsSent?: string[]
  alreadySentToday?: string[]
  prompted?: number
  autoLost?: number
  failed?: { to: string; error: string }[]
  note?: string
  skipped?: string
  boot?: string
  authedAs?: string
  smtpLib?: string
  tcp?: Record<string, string>
  secretsPresent?: Record<string, unknown>
}

/**
 * Call the reminder Edge Function as the signed-in user.
 *
 * No cron secret is involved: the function accepts a tracker user's JWT, which
 * the Supabase client attaches. That keeps the shared secret out of this
 * server's configuration entirely.
 */
export async function invokeReminders(payload: Record<string, unknown>): Promise<ReminderRunResult> {
  const sb = await client()
  const { data, error } = await sb.functions.invoke('follow-up-reminders', { body: payload })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { return (await ctx.json()) as ReminderRunResult } catch { /* fall through */ }
    }
    return { ok: false, error: error.message || String(error) }
  }
  return (data ?? { ok: false, error: 'empty response from the function' }) as ReminderRunResult
}

// ── legacy account-wide settings (pre-workspace) ─────────────────────────────

export async function getAppSetting<T>(key: string): Promise<T | null> {
  const sb = await client()
  const { data, error } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) return null
  return (data?.value as T) ?? null
}

export async function managerEmailFor(p: Project): Promise<string> {
  const own = (p.follow_up_manager_email ?? '').trim()
  if (own) return own
  const legacy = await getAppSetting<string>('follow_up_manager_email')
  return typeof legacy === 'string' ? legacy.trim() : ''
}

export async function automationFor(p: Project): Promise<Automation> {
  return p.follow_up_automation
}
