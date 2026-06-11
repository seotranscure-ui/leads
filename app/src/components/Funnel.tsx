import { useMemo, useState } from 'react'
import { useAppData } from '../data/AppData'
import { FUNNEL_ORDER, STAGE_COLOR, isDemo, isWon, type Stage } from '../lib/funnel'
import { isHigh, type Lead } from '../lib/leads'
import { monthlyStats, pct, monthKey } from '../lib/stats'
import { PK_ZONE } from '../lib/time'

export default function Funnel() {
  const { leads, rule } = useAppData()
  const [fMonth, setFMonth] = useState('')
  const [fSource, setFSource] = useState('')

  const months = useMemo(() => {
    const map = new Map<string, string>()
    leads.forEach((l) => { const k = monthKey(l); if (!map.has(k)) map.set(k, l.created_utc ? new Intl.DateTimeFormat('en-US', { timeZone: PK_ZONE, year: 'numeric', month: 'long' }).format(new Date(l.created_utc)) : 'Unknown date') })
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [leads])
  const sources = useMemo(() => [...new Set(leads.map((l) => l.source))].sort(), [leads])

  const ff = (l: Lead) => (!fMonth || monthKey(l) === fMonth) && (!fSource || l.source === fSource)
  const all = leads.filter(ff)

  const counts: Record<Stage, number> = { Lead: 0, Engaged: 0, Demo: 0, Audit: 0, Negotiation: 0, Won: 0, Lost: 0 }
  all.forEach((l) => { counts[l.stage as Stage] = (counts[l.stage as Stage] || 0) + 1 })
  const max = Math.max(1, ...Object.values(counts))
  const demos = all.filter((l) => isDemo(l.stage)).length
  const sales = all.filter((l) => isWon(l.stage)).length
  const ht = all.filter((l) => isHigh(l, rule)).length

  const pg: Record<string, number> = {}
  all.forEach((l) => { const p = (l.first_page || '(unknown)').replace(/^https?:\/\/[^/]+/, '') || '/'; pg[p] = (pg[p] || 0) + 1 })
  const top = Object.entries(pg).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const monthly = monthlyStats(leads, rule, ff)

  return (
    <>
      <div className="controls">
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <h2 className="section">Funnel stages</h2>
          {FUNNEL_ORDER.map((s) => (
            <div className="funnelbar" key={s}>
              <div className="name">{s}</div>
              <div className="bar" style={{ width: (counts[s] / max) * 100 + '%', background: STAGE_COLOR[s] }}>{counts[s]}</div>
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 10 }}>A lead counts as a <b>Demo</b> if its current stage is Demo, Audit, Negotiation or Won. Lost leads are excluded from demo counts.</p>
        </div>
        <div className="card">
          <h2 className="section">Conversion ratios</h2>
          <table><tbody>
            <tr><td>Total leads</td><td className="right"><b>{all.length}</b></td></tr>
            <tr><td>Leads → Demos</td><td className="right"><b>{pct(demos, all.length)}</b> ({demos})</td></tr>
            <tr><td>Demos → Sales</td><td className="right"><b>{pct(sales, demos)}</b> ({sales})</td></tr>
            <tr><td>High-ticket share</td><td className="right"><b>{pct(ht, all.length)}</b> ({ht})</td></tr>
          </tbody></table>
          <h2 className="section">Top first-visited pages (SEO)</h2>
          <table><tbody>{top.map(([p, c]) => <tr key={p}><td className="small">{p}</td><td className="right">{c}</td></tr>)}</tbody></table>
        </div>
      </div>

      <h2 className="section">Monthly ratios</h2>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Month</th><th className="right">Leads</th><th className="right">Demos</th><th className="right">Sales</th><th className="right">Leads→Demos</th><th className="right">Demos→Sales</th><th className="right">High-ticket %</th></tr></thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.key}><td>{m.label}</td><td className="right">{m.leads}</td><td className="right">{m.demos}</td><td className="right">{m.sales}</td><td className="right">{pct(m.demos, m.leads)}</td><td className="right">{pct(m.sales, m.demos)}</td><td className="right">{pct(m.ht, m.leads)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
