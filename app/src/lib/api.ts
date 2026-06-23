import { supabase } from './supabase'
import { DEFAULT_RULE, type CrmLead, type HighTicketRule, type Lead, type ManualPatch } from './leads'

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

const MANUAL_COLS = 'manual_ticket, manual_high, manual_notes, manual_source_medium, manual_first_landing, manual_second_page, manual_submit_page, manual_search_query, manual_recording'
const BLANK_MANUAL: Partial<Lead> = {
  manual_ticket: null, manual_high: null, manual_notes: null,
  manual_source_medium: null, manual_first_landing: null, manual_second_page: null,
  manual_submit_page: null, manual_search_query: null, manual_recording: null,
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
