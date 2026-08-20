import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  createLead, deleteLead, fetchLeads, saveManual,
  fetchSequences, fetchStepsFor, createSequence as apiCreateSequence,
  markStepDone as apiMarkStepDone, updateStepDate as apiUpdateStepDate,
  markSequenceStatus, updateSequenceEmail as apiUpdateSeqEmail,
  updateLeadStageAndStatus, provisionSequences,
  setStepChannels as apiSetStepChannels,
  fetchProjects, saveProject,
  type Automation,
} from '../lib/api'
import { type HighTicketRule, type Lead, type ManualPatch } from '../lib/leads'
import { type FollowUpSequence, type FollowUpStep, STEP_CHANNELS, defaultDates, todayIso } from '../lib/followups'
import {
  DEFAULT_PROJECT_ID, FALLBACK_PROJECT, lostStageName, lostStatusFor,
  type FunnelConfig, type Project,
} from '../lib/projects'

// Remembers the selected workspace across reloads, per browser.
const LS_PROJECT = 'transcure_project_v1'

export interface Drill { label: string; test: (l: Lead) => boolean }

interface AppCtx {
  // workspace
  projects: Project[]
  project: Project
  projectId: string
  setProjectId: (id: string) => void
  funnel: FunnelConfig
  updateProject: (patch: Partial<Project>) => Promise<void>

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
  const [projects, setProjects] = useState<Project[]>([FALLBACK_PROJECT])
  const [projectId, setProjectIdState] = useState<string>(
    () => localStorage.getItem(LS_PROJECT) || DEFAULT_PROJECT_ID,
  )
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [sequences, setSequences] = useState<FollowUpSequence[]>([])
  const [steps, setSteps] = useState<FollowUpStep[]>([])
  const [followUpError, setFollowUpError] = useState<string | null>(null)

  // The selected project is the single source of truth for its own rule, logo,
  // charge %, reminder settings and funnel — they are columns on `projects`, not
  // the shared app_settings rows they used to live in.
  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? FALLBACK_PROJECT
  const funnel = project.funnel ?? FALLBACK_PROJECT.funnel
  const rule = project.high_ticket_rule ?? FALLBACK_PROJECT.high_ticket_rule
  const logoUrl = project.logo_data_url
  const managerEmail = project.follow_up_manager_email ?? ''
  const automation = project.follow_up_automation ?? FALLBACK_PROJECT.follow_up_automation

  const setProjectId = (id: string) => {
    localStorage.setItem(LS_PROJECT, id)
    setDrill(null)               // a drill-down from another project is meaningless here
    setProjectIdState(id)
  }

  // Follow-up tables load independently of the core data. If they are missing or
  // erroring, we surface it as a warning but NEVER let it block leads from loading.
  // `currentLeads` / `forProject` are passed explicitly because this may run before
  // the corresponding state has committed.
  const loadSequences = async (currentLeads?: Lead[], forProject?: Project) => {
    const proj = forProject ?? project
    try {
      const seqs = await fetchSequences(proj.id)
      const allSteps = await fetchStepsFor(seqs.map((s) => s.id))
      setFollowUpError(null)

      // Auto-provision: every lead at this project's follow-up stage gets a
      // sequence. Keyed on "has ANY sequence" (not just active) so a resolved lead
      // is never silently re-enrolled. A project with no follow_up_stage opts out.
      const pool = currentLeads ?? leads
      const enrolled = new Set(seqs.map((s) => s.lead_record_id))
      const missing = proj.follow_up_stage
        ? pool.filter((l) => l.stage === proj.follow_up_stage && !enrolled.has(l.record_id)).map((l) => l.record_id)
        : []

      if (missing.length) {
        const dates = defaultDates(todayIso())
        await provisionSequences(missing, () =>
          STEP_CHANNELS.map((channels, i) => ({ scheduled_date: dates[i], channels: [...channels] })),
          proj.id,
        )
        const seqs2 = await fetchSequences(proj.id)
        setSequences(seqs2)
        setSteps(await fetchStepsFor(seqs2.map((s) => s.id)))
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
    let proj = project
    try {
      // Projects first — the lead query and the follow-up stage both depend on it.
      const ps = await fetchProjects()
      setProjects(ps)
      proj = ps.find((p) => p.id === projectId) ?? ps[0] ?? FALLBACK_PROJECT
      if (proj.id !== projectId) setProjectIdState(proj.id)

      const l = await fetchLeads(proj.id)
      fetched = l
      setLeads(l)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    await loadSequences(fetched, proj)
  }

  const refreshSequences = () => loadSequences()

  const updateProject: AppCtx['updateProject'] = async (patch) => {
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...patch } : p)))
    try {
      await saveProject(project.id, patch)
    } catch (e) {
      await refresh()
      throw e
    }
  }

  // These four now write to the selected project's own columns rather than the
  // shared app_settings rows, so each workspace keeps its own values.
  const updateManagerEmail = (email: string) => updateProject({ follow_up_manager_email: email })
  const updateAutomation = (a: Automation) => updateProject({ follow_up_automation: a })
  const updateRule = (r: HighTicketRule) => updateProject({ high_ticket_rule: r })
  const updateLogo = (dataUrl: string | null) => updateProject({ logo_data_url: dataUrl })

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

  // Reload whenever the workspace changes — leads, sequences and settings are all
  // project-scoped, so switching has to refetch rather than filter in place.
  useEffect(() => { refresh() }, [projectId])

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

  const startFollowUp: AppCtx['startFollowUp'] = async (leadId, email, stepDefs) => {
    const seq = await apiCreateSequence(leadId, email, stepDefs, project.id)
    setSequences((prev) => [seq, ...prev])
    // Reload steps so they carry their real DB ids.
    setSteps(await fetchStepsFor([...sequences.map((s) => s.id), seq.id]))
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
      // The lost stage and status come from this project's funnel, not a literal —
      // another project may not have a stage called "Lost".
      const stage = lostStageName(funnel)
      const status = lostStatusFor(funnel)
      await updateLeadStageAndStatus(leadRecordId, status, stage)
      setLeads((prev) => prev.map((l) => l.record_id === leadRecordId ? { ...l, status, stage } : l))
    }
  }

  const changeSequenceEmail: AppCtx['changeSequenceEmail'] = async (sequenceId, email) => {
    setSequences((prev) => prev.map((s) => s.id === sequenceId ? { ...s, manager_email: email } : s))
    await apiUpdateSeqEmail(sequenceId, email)
  }

  return (
    <Ctx.Provider value={{
      projects, project, projectId: project.id, setProjectId, funnel, updateProject,
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
