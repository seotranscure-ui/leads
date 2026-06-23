import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createLead, deleteLead, fetchLeads, getRule, saveManual, setRule as setRuleApi } from '../lib/api'
import { DEFAULT_RULE, type HighTicketRule, type Lead, type ManualPatch } from '../lib/leads'

export interface Drill { label: string; test: (l: Lead) => boolean }

interface AppCtx {
  leads: Lead[]
  rule: HighTicketRule
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updateManual: (recordId: string, patch: ManualPatch) => Promise<void>
  addLead: (lead: Lead) => Promise<void>
  removeLead: (recordId: string) => Promise<void>
  updateRule: (r: HighTicketRule) => Promise<void>
  drill: Drill | null
  setDrill: (d: Drill | null) => void
}

const Ctx = createContext<AppCtx | undefined>(undefined)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [rule, setRule] = useState<HighTicketRule>(DEFAULT_RULE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const [l, r] = await Promise.all([fetchLeads(), getRule()])
      setLeads(l)
      setRule(r)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const updateManual: AppCtx['updateManual'] = async (recordId, patch) => {
    setLeads((prev) => prev.map((l) => (l.record_id === recordId ? { ...l, ...patch } : l)))
    try {
      await saveManual(recordId, patch)
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e && typeof e === 'object' ? String((e as Record<string, unknown>).message ?? JSON.stringify(e)) : String(e))
      // Don't let a failed save look successful — tell the user and revert to the DB state.
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

  return (
    <Ctx.Provider value={{ leads, rule, loading, error, refresh, updateManual, addLead, removeLead, updateRule, drill, setDrill }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppData(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppData must be used within AppDataProvider')
  return c
}
