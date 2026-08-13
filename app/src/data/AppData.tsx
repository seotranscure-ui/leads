import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  createLead, deleteLead, fetchLeads, getLogo, getRule, saveManual,
  setLogo as setLogoApi, setRule as setRuleApi,
  fetchSequences, fetchAllSteps, createSequence as apiCreateSequence,
  markStepDone as apiMarkStepDone, updateStepDate as apiUpdateStepDate,
  markSequenceStatus, updateSequenceEmail as apiUpdateSeqEmail,
  updateLeadStageAndStatus, provisionSequences,
  getManagerEmail, setManagerEmail as apiSetManagerEmail,
  setStepChannels as apiSetStepChannels,
  getAutomation, setAutomation as apiSetAutomation,
  DEFAULT_AUTOMATION, type Automation,
} from '../lib/api'
import { DEFAULT_RULE, type HighTicketRule, type Lead, type ManualPatch } from '../lib/leads'
import { type FollowUpSequence, type FollowUpStep, STEP_CHANNELS, defaultDates, todayIso } from '../lib/followups'

// Every lead at this stage gets a follow-up sequence automatically.
const FOLLOW_UP_STAGE = 'Negotiation'

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
  followUpError: string | null
  managerEmail: string
  updateManagerEmail: (email: string) => Promise<void>
  automation: Automation
  updateAutomation: (a: Automation) => Promise<void>
  toggleChannel: (stepId: string, channel: string) => Promise<void>
  startFollowUp: (leadId: string, email: string | null, steps: { scheduled_date: string; channels: string[] }[]) => Promise<void>
  completeStep: (stepId: string, notes?: string) => Promise<void>
  rescheduleStep: (stepId: string, date: string) => Promise<void>
  resolveSequence: (sequenceId: string, outcome: 'won' | 'lost', leadRecordId: string) => Promise<void>
  changeSequenceEmail: (sequenceId: string, email: string | null) => Promise<void>
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
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [managerEmail, setManagerEmailState] = useState('')
  const [automation, setAutomationState] = useState<Automation>(DEFAULT_AUTOMATION)

  // Follow-up tables load independently of the core data. If they are missing or
  // erroring, we surface it as a warning but NEVER let it block leads from loading.
  // `currentLeads` is passed explicitly because this may run before `leads` state
  // has committed, and auto-provisioning needs the freshly-fetched list.
  const loadSequences = async (currentLeads?: Lead[]) => {
    try {
      const [seqs, allSteps, email, auto] = await Promise.all([
        fetchSequences(), fetchAllSteps(), getManagerEmail(), getAutomation(),
      ])
      setManagerEmailState(email)
      setAutomationState(auto)
      setFollowUpError(null)

      // Auto-provision: every lead in the follow-up stage gets a sequence, with no
      // manual step. Keyed on "has ANY sequence" (not just active) so a resolved
      // lead is never silently re-enrolled.
      const pool = currentLeads ?? leads
      const enrolled = new Set(seqs.map((s) => s.lead_record_id))
      const missing = pool.filter((l) => l.stage === FOLLOW_UP_STAGE && !enrolled.has(l.record_id)).map((l) => l.record_id)

      if (missing.length) {
        const dates = defaultDates(todayIso())
        await provisionSequences(missing, () =>
          STEP_CHANNELS.map((channels, i) => ({ scheduled_date: dates[i], channels: [...channels] })),
        )
        const [seqs2, steps2] = await Promise.all([fetchSequences(), fetchAllSteps()])
        setSequences(seqs2)
        setSteps(steps2)
        return
      }

      setSequences(seqs)
      setSteps(allSteps)
    } catch (e) {
      setSequences([])
      setSteps([])
      setFollowUpError(e instanceof Error ? e.message : String(e))
    }
  }

  const refresh = async () => {
    setLoading(true)
    let fetched: Lead[] = []
    try {
      const [l, r, logo] = await Promise.all([fetchLeads(), getRule(), getLogo()])
      fetched = l
      setLeads(l)
      setRule(r)
      setLogoUrl(logo)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    await loadSequences(fetched)
  }

  const refreshSequences = () => loadSequences()

  const updateManagerEmail = async (email: string) => {
    setManagerEmailState(email)
    await apiSetManagerEmail(email)
  }

  const updateAutomation = async (a: Automation) => {
    setAutomationState(a)
    await apiSetAutomation(a)
  }

  // Tick one channel of a week on/off. The week is finished only when every one
  // of its channels is ticked, which is exactly what the reminder job checks.
  const toggleChannel: AppCtx['toggleChannel'] = async (stepId, channel) => {
    const step = steps.find((s) => s.id === stepId)
    if (!step) return
    const current = step.completed_channels ?? []
    const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]
    const done = step.channels.every((c) => next.includes(c))

    setSteps((prev) => prev.map((s) => s.id === stepId
      ? { ...s, completed_channels: next, status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null }
      : s))
    try {
      await apiSetStepChannels(stepId, next, step.channels)
    } catch (e) {
      await refreshSequences()
      alert('Could not save that change: ' + (e instanceof Error ? e.message : String(e)))
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
    setSequences((prev) => [seq, ...prev])
    // Reload steps so they carry their real DB ids.
    setSteps(await fetchAllSteps())
  }

  // Tick every remaining channel of a week at once.
  const completeStep: AppCtx['completeStep'] = async (stepId, notes) => {
    const step = steps.find((s) => s.id === stepId)
    if (!step) return
    setSteps((prev) => prev.map((s) => s.id === stepId
      ? { ...s, completed_channels: [...s.channels], status: 'done', completed_at: new Date().toISOString(), notes: notes ?? null }
      : s))
    try {
      await apiMarkStepDone(stepId, step.channels, notes)
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
      sequences, steps, followUpError, managerEmail, updateManagerEmail,
      automation, updateAutomation, toggleChannel,
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
