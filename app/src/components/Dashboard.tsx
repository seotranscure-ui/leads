import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData, type Drill } from '../data/AppData'
import { isDemo, isWon } from '../lib/funnel'
import { isHigh, ruleLabel, ticketValue, fmtMoney, type HighTicketRule, type Lead } from '../lib/leads'
import { monthlyStats, pct, specKey, monthKey } from '../lib/stats'

export default function Dashboard() {
  const { leads, rule, updateRule, setDrill, loading, error } = useAppData()
  const nav = useNavigate()

  // local rule editor state, synced when the saved rule changes
  const [op, setOp] = useState<HighTicketRule['op']>(rule.op)
  const [v1, setV1] = useState(String(rule.value))
  const [v2, setV2] = useState(String(rule.value2 ?? ''))
  useEffect(() => { setOp(rule.op); setV1(String(rule.value)); setV2(String(rule.value2 ?? '')) }, [rule])
  const applyRule = () => updateRule({ op, value: Number(v1) || 0, value2: op === 'between' ? Number(v2) || 0 : undefined })

  const go = (label: string, test: Drill['test']) => { setDrill({ label, test }); nav('/leads') }

  const stats = useMemo(() => {
    const demos = leads.filter((l) => isDemo(l.stage)).length
    const wons = leads.filter((l) => isWon(l.stage)).length
    const ht = leads.filter((l) => isHigh(l, rule)).length
    const seo = leads.filter((l) => l.source.toLowerCase() === 'seo').length
    const wonMonthly = leads.filter((l) => isWon(l.stage)).reduce((s, l) => s + (ticketValue(l) || 0), 0)
    const months = monthlyStats(leads, rule)
    const bySrc: Record<string, number> = {}
    const bySrcSales: Record<string, { sales: number; coll: number }> = {}
    leads.forEach((l) => {
      bySrc[l.source] = (bySrc[l.source] || 0) + 1
      if (isWon(l.stage)) {
        if (!bySrcSales[l.source]) bySrcSales[l.source] = { sales: 0, coll: 0 }
        bySrcSales[l.source].sales++
        bySrcSales[l.source].coll += ticketValue(l) || 0
      }
    })
    const sp: Record<string, { leads: number; demos: number; sales: number; ht: number; coll: number }> = {}
    leads.forEach((l) => {
      const k = specKey(l)
      if (!sp[k]) sp[k] = { leads: 0, demos: 0, sales: 0, ht: 0, coll: 0 }
      sp[k].leads++
      if (isDemo(l.stage)) sp[k].demos++
      if (isWon(l.stage)) { sp[k].sales++; sp[k].coll += ticketValue(l) || 0 }
      if (isHigh(l, rule)) sp[k].ht++
    })
    return { demos, wons, ht, seo, wonMonthly, months,
      srcRows: Object.entries(bySrc).sort((a, b) => b[1] - a[1]),
      srcSalesRows: Object.entries(bySrcSales).sort((a, b) => b[1].sales - a[1].sales),
      spRows: Object.entries(sp).sort((a, b) => b[1].leads - a[1].leads) }
  }, [leads, rule])

  if (loading) return <div className="center-msg">Loading leads…</div>
  if (error) return <div className="note err">{error}</div>
  if (!leads.length)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <p className="muted">No leads yet. Go to <b>Upload</b> and import your Zoho CRM export.</p>
        <button className="btn" onClick={() => nav('/upload')}>Upload CRM export</button>
      </div>
    )

  const all = leads
  const { demos, wons, ht, seo, wonMonthly, months, srcRows, srcSalesRows, spRows } = stats
  const totalWon = wons
  const isSeo = (l: Lead) => l.source.toLowerCase() === 'seo'

  const kpis: [string, string | number, string, () => void][] = [
    ['Total leads', all.length, '', () => go('All leads', () => true)],
    ['SEO leads', seo, pct(seo, all.length) + ' of all', () => go('SEO leads', isSeo)],
    ['Demos', demos, pct(demos, all.length) + ' of leads', () => go('Demos (reached demo+)', (l) => isDemo(l.stage))],
    ['Sales (Won)', wons, pct(wons, demos) + ' of demos', () => go('Sales — Won', (l) => isWon(l.stage))],
    ['Won collections /mo', fmtMoney(wonMonthly), 'sum of won tickets', () => go('Won leads', (l) => isWon(l.stage))],
    ['High-ticket', ht, pct(ht, all.length) + ' of leads', () => go('High-ticket leads', (l) => isHigh(l, rule))],
  ]

  return (
    <>
      <div className="controls">
        <label className="small muted">High-ticket rule: Monthly Collections</label>
        <select value={op} onChange={(e) => setOp(e.target.value as HighTicketRule['op'])}>
          <option value="gte">≥ (at least)</option>
          <option value="gt">&gt; (more than)</option>
          <option value="lte">≤ (at most)</option>
          <option value="lt">&lt; (less than)</option>
          <option value="between">between</option>
        </select>
        <input type="number" value={v1} onChange={(e) => setV1(e.target.value)} style={{ width: 120 }} placeholder="$" />
        {op === 'between' && (<><span className="small muted">and</span><input type="number" value={v2} onChange={(e) => setV2(e.target.value)} style={{ width: 120 }} placeholder="$" /></>)}
        <button className="btn ghost" onClick={applyRule}>Apply</button>
        <span className="small muted">Current: {ruleLabel(rule)} — or manual ⭐</span>
      </div>

      <div className="grid kpis">
        {kpis.map((k, i) => (
          <div className="card kpi clickable" key={i} onClick={k[3]}>
            <div className="label">{k[0]}</div>
            <div className="val">{k[1]}</div>
            <div className="sub">{k[2]}</div>
          </div>
        ))}
      </div>

      <h2 className="section">Monthly performance (by PK submission date)</h2>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Month</th><th className="right">Leads</th><th className="right">Demos</th><th className="right">Sales</th><th className="right">Collections</th><th className="right">High-ticket</th><th className="right">Leads→Demos</th><th className="right">Demos→Sales</th><th className="right">High-ticket %</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td className="right link" onClick={() => go('Leads · ' + m.label, (l) => monthKey(l) === m.key)}>{m.leads}</td>
                  <td className="right link" onClick={() => go('Demos · ' + m.label, (l) => monthKey(l) === m.key && isDemo(l.stage))}>{m.demos}</td>
                  <td className="right link" onClick={() => go('Sales · ' + m.label, (l) => monthKey(l) === m.key && isWon(l.stage))}>{m.sales}</td>
                  <td className="right" title="Total monthly collections from closed (won) leads">{fmtMoney(m.coll) || '—'}</td>
                  <td className="right link" onClick={() => go('High-ticket · ' + m.label, (l) => monthKey(l) === m.key && isHigh(l, rule))}>{m.ht}</td>
                  <td className="right">{pct(m.demos, m.leads)}</td>
                  <td className="right">{pct(m.sales, m.demos)}</td>
                  <td className="right">{pct(m.ht, m.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div>
          <h2 className="section">Lead source breakdown</h2>
          <div className="card">
            <table>
              <thead><tr><th>Source</th><th className="right">Leads</th><th className="right">Share</th></tr></thead>
              <tbody>
                {srcRows.map(([s, c]) => (
                  <tr className="link" key={s} onClick={() => go('Source: ' + s, (l) => l.source === s)}>
                    <td>{s}</td><td className="right">{c}</td><td className="right">{pct(c, all.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section">Sales by source</h2>
          <div className="card">
            <table>
              <thead><tr><th>Source</th><th className="right">Sales</th><th className="right">Share</th></tr></thead>
              <tbody>
                {srcSalesRows.length === 0 ? (
                  <tr><td colSpan={3} className="muted small">No closed (won) leads yet.</td></tr>
                ) : srcSalesRows.map(([s, v]) => (
                  <tr className="link" key={s} onClick={() => go('Won · ' + s, (l) => l.source === s && isWon(l.stage))}>
                    <td>{s}</td><td className="right">{v.sales}</td><td className="right">{pct(v.sales, totalWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="section">Specialty breakdown</h2>
          <div className="card" style={{ padding: 0 }}>
            <div className="tablewrap" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>Specialty</th><th className="right">Leads</th><th className="right">Demos</th><th className="right">Sales</th><th className="right">Collections</th><th className="right">High</th><th className="right">L→D</th><th className="right">D→S</th></tr></thead>
                <tbody>
                  {spRows.map(([s, v]) => (
                    <tr key={s}>
                      <td className="link" onClick={() => go('Specialty: ' + s, (l) => specKey(l) === s)}>{s}</td>
                      <td className="right link" onClick={() => go('Specialty: ' + s, (l) => specKey(l) === s)}>{v.leads}</td>
                      <td className="right link" onClick={() => go('Demos · ' + s, (l) => specKey(l) === s && isDemo(l.stage))}>{v.demos}</td>
                      <td className="right link" onClick={() => go('Sales · ' + s, (l) => specKey(l) === s && isWon(l.stage))}>{v.sales}</td>
                      <td className="right" title="Collections from closed (won) leads">{fmtMoney(v.coll) || '—'}</td>
                      <td className="right link" onClick={() => go('High-ticket · ' + s, (l) => specKey(l) === s && isHigh(l, rule))}>{v.ht}</td>
                      <td className="right">{pct(v.demos, v.leads)}</td>
                      <td className="right">{pct(v.sales, v.demos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
