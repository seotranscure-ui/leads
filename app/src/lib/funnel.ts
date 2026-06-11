// Funnel stages and the mapping from Zoho "Lead Status" values.
export const FUNNEL_ORDER = ['Lead', 'Engaged', 'Demo', 'Audit', 'Negotiation', 'Won', 'Lost'] as const
export type Stage = (typeof FUNNEL_ORDER)[number]

export const STAGE_COLOR: Record<Stage, string> = {
  Lead: '#94a3b8',
  Engaged: '#3b82f6',
  Demo: '#6366f1',
  Audit: '#16a34a',
  Negotiation: '#0891b2',
  Won: '#15803d',
  Lost: '#dc2626',
}

// Real Zoho "Lead Status" values -> funnel stage (lowercased keys).
const STATUS_MAP: Record<string, Stage> = {
  'contacted': 'Engaged',
  'attempted to contact': 'Engaged',
  'follow up': 'Engaged',
  'contact in future': 'Engaged',
  'demo scheduled': 'Demo',
  'demo completed': 'Demo',
  'demo done': 'Demo',
  'under audit': 'Audit',
  'agreement sent': 'Negotiation',
  'contract sent': 'Negotiation',
  'won lead': 'Won',
  'won': 'Won',
  'lost lead': 'Lost',
  'lost / contract lead': 'Lost',
  'not-qualified': 'Lost',
  'not qualified': 'Lost',
  'junk lead': 'Lost',
}

export function stageFor(status: string | null | undefined): Stage {
  return STATUS_MAP[(status || '').trim().toLowerCase()] || 'Lead'
}

export const stageIdx = (s: string) => FUNNEL_ORDER.indexOf(s as Stage)
// A lead "reached demo" if its current stage is Demo, Audit, Negotiation or Won.
export const isDemo = (s: string) => { const i = stageIdx(s); return i >= 2 && i <= 5 }
export const isWon = (s: string) => s === 'Won'
