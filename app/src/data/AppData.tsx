import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchLeads, getRule, saveManual, setRule as setRuleApi } from '../lib/api'
import { DEFAULT_RULE, type HighTicketRule, type Lead } from '../lib/leads'

export interface Drill { label: string; test: (l: Lead) => boolean }

interface AppCtx {
  leads: Lead[]
  rule: HighTicketRule
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updateManual: (recordId: string, patch: Partial<Pick<Lead, 'manual_ticket' | 'manual_high' | 'manual_notes'>>) => Promise<void>
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
    await saveManual(recordId, patch)
  }

  const updateRule = async (r: HighTicketRule) => {
    setRule(r)
    await setRuleApi(r)
  }

  return (
    <Ctx.Provider value={{ leads, rule, loading, error, refresh, updateManual, updateRule, drill, setDrill }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppData(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppData must be used within AppDataProvider')
  return c
}
