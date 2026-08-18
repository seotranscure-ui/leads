import { supabase } from './supabase'
import { DEFAULT_RULE, type CrmLead, type HighTicketRule, type Lead, type ManualPatch } from './leads'
import type { FollowUpSequence, FollowUpStep } from './followups'

// Fetch all leads (paged past PostgREST's 1000-row default cap).
export async function fetchLeads(): Promise<Lead[]> {
  const all: Lead[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_utc', { ascending: false, nullsFirst: false })
      .range(from, from + size - 1)
    if (error) throw error
    all.push(...(data as Lead[]))
    if (!data || data.length < size) break
  }
  return all
}

export interface ImportResult { total: number; inserted: number; updated: number }

const MANUAL_COLS = 'manual_ticket, manual_high, manual_notes, manual_source_medium, manual_first_landing, manual_second_page, manual_submit_page, manual_search_query, manual_recording, manual_charge_pct, manual_revenue_month'
const BLANK_MANUAL: Partial<Lead> = {
  manual_ticket: null, manual_high: null, manual_notes: null,
  manual_source_medium: null, manual_first_landing: null, manual_second_page: null,
  manual_submit_page: null, manual_search_query: null, manual_recording: null, manual_charge_pct: null, manual_revenue_month: null,
}

// Upsert CRM rows by record_id. To guarantee an import NEVER wipes manually-entered
// data, we first read back each existing lead's manual_* fields and merge them into
// the payload — so the import refreshes CRM columns while re-writing manual data unchanged.
export async function importLeads(rows: CrmLead[], fileName: string): Promise<ImportResult> {
  const ids = rows.map((r) => r.record_id).filter(Boolean)
  const manualById = new Map<string, Partial<Lead>>()
  for (let i = 0; i < ids.length; i += 1000) {
    const slice = ids.slice(i, i + 1000)
    const { data, error } = await supabase.from('leads').select(`record_id, ${MANUAL_COLS}`).in('record_id', slice)
    if (error) throw error
    data?.forEach((d) => manualById.set((d as { record_id: string }).record_id, d as Partial<Lead>))
  }
  const inserted = ids.filter((id) => !manualById.has(id)).length
  const updated = ids.length - inserted

  // CRM columns come from the file; manual columns are preserved (existing) or null (new lead).
  const merged = rows.map((r) => ({ ...r, ...BLANK_MANUAL, ...(manualById.get(r.record_id) ?? {}) }))

  for (let i = 0; i < merged.length; i += 500) {
    const chunk = merged.slice(i, i + 500)
    const { error } = await supabase.from('leads').upsert(chunk, { onConflict: 'record_id' })
    if (error) throw error
  }

  const { data: u } = await supabase.auth.getUser()
  const meta = {
    file_name: fileName,
    uploaded_by: u?.user?.id ?? null,
    rows_total: rows.length,
    rows_inserted: inserted,
    rows_updated: updated,
  }
  // History logging is best-effort — it must never fail the actual import.
  // If the `rows` column hasn't been migrated yet, fall back to logging without it.
  try {
    const { error: be } = await supabase.from('import_batches').insert({ ...meta, rows })
    if (be) await supabase.from('import_batches').insert(meta)
  } catch { /* ignore logging failure */ }

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

// Import history (lightweight — excludes the heavy rows payload).
export async function fetchImportBatches(): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('id, file_name, uploaded_at, rows_total, rows_inserted, rows_updated')
    .order('uploaded_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as ImportBatch[]
}

// Re-apply a previous import: re-upsert its stored rows (manual_* fields stay intact).
export async function reapplyBatch(id: string): Promise<ImportResult> {
  const { data, error } = await supabase.from('import_batches').select('file_name, rows').eq('id', id).single()
  if (error) throw error
  const rows = (data?.rows ?? []) as CrmLead[]
  if (!rows.length) throw new Error('This import has no stored rows to re-apply (it predates version history).')
  return importLeads(rows, `Re-applied: ${data?.file_name ?? 'import'}`)
}

// Save the manual enrichment fields for one lead (never overwritten by import).
export async function saveManual(recordId: string, patch: ManualPatch): Promise<void> {
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('leads')
    .update({ ...patch, manual_updated_by: u?.user?.id ?? null, manual_updated_at: new Date().toISOString() })
    .eq('record_id', recordId)
  if (error) throw error
}

// Manually add one lead (not from CSV). record_id is caller-generated.
export async function createLead(lead: Lead): Promise<void> {
  const { error } = await supabase.from('leads').insert(lead)
  if (error) throw error
}

// Permanently delete a lead.
export async function deleteLead(recordId: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('record_id', recordId)
  if (error) throw error
}

export async function getRule(): Promise<HighTicketRule> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'high_ticket_rule').maybeSingle()
  const v = data?.value as unknown
  if (v && typeof v === 'object' && 'op' in (v as object)) return v as HighTicketRule
  // Migrate from the old single-threshold setting if present.
  const { data: t } = await supabase.from('app_settings').select('value').eq('key', 'high_ticket_threshold').maybeSingle()
  const n = typeof t?.value === 'number' ? t.value : Number(t?.value)
  if (n && !isNaN(n)) return { op: 'gte', value: n }
  return DEFAULT_RULE
}

export async function setRule(rule: HighTicketRule): Promise<void> {
  await supabase.from('app_settings').upsert({ key: 'high_ticket_rule', value: rule as unknown as object, updated_at: new Date().toISOString() })
}

// Logo is stored as a data: URL string in app_settings (no Storage bucket needed).
export async function getLogo(): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'logo_data_url').maybeSingle()
  return typeof data?.value === 'string' ? (data.value as string) : null
}

export async function setLogo(dataUrl: string | null): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert({ key: 'logo_data_url', value: dataUrl as unknown as object, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ── Follow-up sequences ──────────────────────────────────────────────────────

export async function fetchSequences(): Promise<FollowUpSequence[]> {
  const { data, error } = await supabase
    .from('follow_up_sequences')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FollowUpSequence[]
}

export async function fetchAllSteps(): Promise<FollowUpStep[]> {
  const { data, error } = await supabase
    .from('follow_up_steps')
    .select('*')
    .order('step_number')
  if (error) throw error
  return (data ?? []) as FollowUpStep[]
}

export async function createSequence(
  leadRecordId: string,
  managerEmail: string | null,
  steps: { scheduled_date: string; channels: string[] }[],
): Promise<FollowUpSequence> {
  const { data: u } = await supabase.auth.getUser()
  const { data: seq, error: se } = await supabase
    .from('follow_up_sequences')
    .insert({ lead_record_id: leadRecordId, manager_email: managerEmail, started_by: u?.user?.id ?? null })
    .select()
    .single()
  if (se) throw se
  const stepRows = steps.map((s, i) => ({
    sequence_id: (seq as FollowUpSequence).id,
    step_number: i + 1,
    scheduled_date: s.scheduled_date,
    channels: s.channels,
  }))
  const { error: ste } = await supabase.from('follow_up_steps').insert(stepRows)
  if (ste) throw ste
  return seq as FollowUpSequence
}

// Auto-provision a sequence for every lead that needs one. Sequences inherit the
// account-wide manager email (manager_email = null), and steps default to weekly.
// Returns the number of sequences created.
export async function provisionSequences(
  leadIds: string[],
  stepsFor: (leadId: string) => { scheduled_date: string; channels: string[] }[],
): Promise<number> {
  if (!leadIds.length) return 0
  const { data: u } = await supabase.auth.getUser()
  const uid = u?.user?.id ?? null

  // ignoreDuplicates: if another session enrolled the same lead a moment ago, the
  // unique constraint on lead_record_id makes this a no-op instead of an error.
  const { data: created, error: se } = await supabase
    .from('follow_up_sequences')
    .upsert(
      leadIds.map((id) => ({ lead_record_id: id, manager_email: null, started_by: uid })),
      { onConflict: 'lead_record_id', ignoreDuplicates: true },
    )
    .select()
  if (se) throw se

  const rows = (created ?? []) as FollowUpSequence[]
  const stepRows = rows.flatMap((seq) =>
    stepsFor(seq.lead_record_id).map((s, i) => ({
      sequence_id: seq.id,
      step_number: i + 1,
      scheduled_date: s.scheduled_date,
      channels: s.channels,
    })),
  )
  if (stepRows.length) {
    const { error: ste } = await supabase.from('follow_up_steps').insert(stepRows)
    if (ste) throw ste
  }
  return rows.length
}

// Account-wide lead-manager email used for reminders unless a sequence overrides it.
export async function getManagerEmail(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'follow_up_manager_email').maybeSingle()
  return typeof data?.value === 'string' ? (data.value as string) : ''
}

export async function setManagerEmail(email: string): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'follow_up_manager_email', value: email as unknown as object, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function markStepDone(stepId: string, channels: string[], notes?: string): Promise<void> {
  const { error } = await supabase
    .from('follow_up_steps')
    .update({ status: 'done', completed_channels: channels, completed_at: new Date().toISOString(), notes: notes ?? null })
    .eq('id', stepId)
  if (error) throw error
}

// Tick one channel of a week off (or back on). `status` stays in sync so the
// reminder job and the UI agree on when a week is finished.
export async function setStepChannels(stepId: string, completed: string[], all: string[]): Promise<void> {
  const done = all.every((c) => completed.includes(c))
  const { error } = await supabase
    .from('follow_up_steps')
    .update({
      completed_channels: completed,
      status: done ? 'done' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', stepId)
  if (error) throw error
}

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
}

export async function fetchReminderLog(limit = 20): Promise<ReminderLog[]> {
  const { data, error } = await supabase
    .from('follow_up_reminders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ReminderLog[]
}

export interface Automation {
  enabled: boolean
  digestHour: number
  timezone: string
  graceDays: number
  remindOverdueDaily: boolean
}
export const DEFAULT_AUTOMATION: Automation = {
  enabled: true, digestHour: 9, timezone: 'Asia/Karachi', graceDays: 7, remindOverdueDaily: true,
}

// Invoke the reminder Edge Function as the signed-in user. The function verifies
// the caller is a real tracker user, so no client-side secret is involved.
export interface ReminderRunResult {
  ok: boolean
  error?: string
  missingSecrets?: string[]
  tested?: string
  today?: string
  dryRun?: boolean
  digestsSent?: string[]
  /** Recipients whose digest already went out today, so it was not re-sent. */
  alreadySentToday?: string[]
  prompted?: number
  autoLost?: number
  failed?: { to: string; error: string }[]
  note?: string
  skipped?: string
}

async function invokeReminders(payload: Record<string, unknown>): Promise<ReminderRunResult> {
  const { data, error } = await supabase.functions.invoke('follow-up-reminders', { body: payload })
  // A non-2xx reply still carries a useful JSON body, so read it rather than
  // surfacing the bare "non-2xx status code" message.
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { return await ctx.json() as ReminderRunResult } catch { /* fall through */ }
    }
    return { ok: false, error: error.message || String(error) }
  }
  return (data ?? { ok: false, error: 'empty response' }) as ReminderRunResult
}

/** Send one test email to `to`, to prove SMTP works. */
export function sendTestReminder(to: string): Promise<ReminderRunResult> {
  return invokeReminders({ test: to })
}

/** Report what a real run would send, without sending anything. */
export function previewReminders(): Promise<ReminderRunResult> {
  return invokeReminders({ dry: true })
}

/** Run the digest for real, now, instead of waiting for the schedule. */
export function runRemindersNow(): Promise<ReminderRunResult> {
  return invokeReminders({})
}

export async function getAutomation(): Promise<Automation> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'follow_up_automation').maybeSingle()
  const v = data?.value
  if (v && typeof v === 'object') return { ...DEFAULT_AUTOMATION, ...(v as Partial<Automation>) }
  return DEFAULT_AUTOMATION
}

export async function setAutomation(a: Automation): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'follow_up_automation', value: a as unknown as object, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function updateStepDate(stepId: string, date: string): Promise<void> {
  const { error } = await supabase.from('follow_up_steps').update({ scheduled_date: date }).eq('id', stepId)
  if (error) throw error
}

export async function markSequenceStatus(sequenceId: string, status: 'active' | 'won' | 'lost'): Promise<void> {
  const { error } = await supabase.from('follow_up_sequences').update({ status }).eq('id', sequenceId)
  if (error) throw error
}

// Pass null to clear the override and fall back to the Admin default.
export async function updateSequenceEmail(sequenceId: string, email: string | null): Promise<void> {
  const { error } = await supabase.from('follow_up_sequences').update({ manager_email: email }).eq('id', sequenceId)
  if (error) throw error
}

export async function updateLeadStageAndStatus(recordId: string, status: string, stage: string): Promise<void> {
  const { error } = await supabase.from('leads').update({ status, stage }).eq('record_id', recordId)
  if (error) throw error
}
