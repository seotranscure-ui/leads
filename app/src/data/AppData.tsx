import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  createLead, deleteLead, fetchLeads, getLogo, getRule, saveManual,
  setLogo as setLogoApi, setRule as setRuleApi,
  fetchSequences, fetchAllSteps, createSequence as apiCreateSequence,
  markStepDone as apiMarkStepDone, updateStepDate as apiUpdateStepDate,
  markSequenceStatus, updateSequenceEmail as apiUpdateSeqEmail,
  updateLeadStageAndStatus,
} from '../lib/api'
import { DEFAULT_RULE, type HighTicketRule, type Lead, type ManualPatch } from '../lib/leads'
import { type FollowUpSequence, type FollowUpStep, STEP_CHANNELS } from '../lib/followups'

export interface Drill { label: string; test: (l: Lead) => boolean }

interface AppCtx {
  leads: Lead[]
  rule: HighTicketRule
  logoUrl: string | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updateManual: (recordId: string, patch: ManualPatch) => Promise<void>
  addLead: (lead: Lead) => Promise<void>
  removeLead: (recordId: string) => Promise<void>
  updateRule: (r: HighTicketRule) => Promise<void>
  updateLogo: (dataUrl: string | null) => Promise<void>
  drill: Drill | null
  setDrill: (d: Drill | null) => void
  // follow-up sequences
  sequences: FollowUpSequence[]
  steps: FollowUpStep[]
  startFollowUp: (leadId: string, email: string, steps: { scheduled_date: string; channels: string[] }[]) => Promise<void>
  completeStep: (stepId: string, notes?: string) => Promise<void>
  rescheduleStep: (stepId: string, date: string) => Promise<void>
  resolveSequence: (sequenceId: string, outcome: 'won' | 'lost', leadRecordId: string) => Promise<void>
  changeSequenceEmail: (sequenceId: string, email: string) => Promise<void>
  refreshSequences: () => Promise<void>
}

const Ctx = createContext<AppCtx | undefined>(undefined)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [rule, setRule] = useState<HighTicketRule>(DEFAULT_RULE)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [sequences, setSequences] = useState<FollowUpSequence[]>([])
  const [steps, setSteps] = useState<FollowUpStep[]>([])

  const refresh = async () => {
    setLoading(true)
    try {
      const [l, r, logo] = await Promise.all([fetchLeads(), getRule(), getLogo()])
      setLeads(l)
      setRule(r)
      setLogoUrl(logo)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // Load follow-up tables separately — if they don't exist yet they must not block leads.
    try {
      const [seqs, allSteps] = await Promise.all([fetchSequences(), fetchAllSteps()])
      setSequences(seqs)
      setSteps(allSteps)
    } catch {
      // Tables not yet migrated; sequences stay empty, main data is unaffected.
    }
  }

  const refreshSequences = async () => {
    try {
      const [seqs, allSteps] = await Promise.all([fetchSequences(), fetchAllSteps()])
      setSequences(seqs)
      setSteps(allSteps)
    } catch {
      // Non-fatal if tables aren't migrated yet.
    }
  }

  useEffect(() => { refresh() }, [])

  const updateManual: AppCtx['updateManual'] = async (recordId, patch) => {
    setLeads((prev) => prev.map((l) => (l.record_id === recordId ? { ...l, ...patch } : l)))
    try {
      await saveManual(recordId, patch)
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e && typeof e === 'object' ? String((e as Record<string, unknown>).message ?? JSON.stringify(e)) : String(e))
      alert('Could not save your change — it was NOT stored.\n\n' + msg + '\n\n(If this mentions a missing column, the Supabase schema needs updating — re-run schema.sql.)')
      await refresh()
    }
  }

  const addLead = async (lead: Lead) => {
    await createLead(lead)
    setLeads((prev) => [lead, ...prev])
  }

  const removeLead = async (recordId: string) => {
    await deleteLead(recordId)
    setLeads((prev) => prev.filter((l) => l.record_id !== recordId))
  }

  const updateRule = async (r: HighTicketRule) => {
    setRule(r)
    await setRuleApi(r)
  }

  const updateLogo = async (dataUrl: string | null) => {
    await setLogoApi(dataUrl)
    setLogoUrl(dataUrl)
  }

  const startFollowUp: AppCtx['startFollowUp'] = async (leadId, email, stepDefs) => {
    const seq = await apiCreateSequence(leadId, email, stepDefs)
    const newSteps: FollowUpStep[] = stepDefs.map((s, i) => ({
      id: `tmp-${i}`,
      sequence_id: seq.id,
      step_number: i + 1,
      scheduled_date: s.scheduled_date,
      channels: s.channels,
      status: 'pending',
      completed_at: null,
      notes: null,
    }))
    setSequences((prev) => [seq, ...prev])
    // Reload steps to get real IDs from the DB
    const allSteps = await fetchAllSteps()
    setSteps(allSteps)
  }

  const completeStep: AppCtx['completeStep'] = async (stepId, notes) => {
    setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, status: 'done', completed_at: new Date().toISOString(), notes: notes ?? null } : s))
    try {
      await apiMarkStepDone(stepId, notes)
    } catch (e) {
      await refreshSequences()
      throw e
    }
  }

  const rescheduleStep: AppCtx['rescheduleStep'] = async (stepId, date) => {
    setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, scheduled_date: date } : s))
    try {
      await apiUpdateStepDate(stepId, date)
    } catch (e) {
      await refreshSequences()
      throw e
    }
  }

  const resolveSequence: AppCtx['resolveSequence'] = async (sequenceId, outcome, leadRecordId) => {
    setSequences((prev) => prev.map((s) => s.id === sequenceId ? { ...s, status: outcome } : s))
    await markSequenceStatus(sequenceId, outcome)
    if (outcome === 'lost') {
      await updateLeadStageAndStatus(leadRecordId, 'Lost Lead', 'Lost')
      setLeads((prev) => prev.map((l) => l.record_id === leadRecordId ? { ...l, status: 'Lost Lead', stage: 'Lost' } : l))
    }
  }

  const changeSequenceEmail: AppCtx['changeSequenceEmail'] = async (sequenceId, email) => {
    setSequences((prev) => prev.map((s) => s.id === sequenceId ? { ...s, manager_email: email } : s))
    await apiUpdateSeqEmail(sequenceId, email)
  }

  return (
    <Ctx.Provider value={{
      leads, rule, logoUrl, loading, error, refresh,
      updateManual, addLead, removeLead, updateRule, updateLogo,
      drill, setDrill,
      sequences, steps,
      startFollowUp, completeStep, rescheduleStep, resolveSequence,
      changeSequenceEmail, refreshSequences,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppData(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppData must be used within AppDataProvider')
  return c
}
