import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData, type Drill } from '../data/AppData'
import { isDemo, isWon } from '../lib/funnel'
import { isHigh, leadRevenue, ruleLabel, ticketValue, fmtMoney, type Lead } from '../lib/leads'
import { monthlyStats, pct, specKey, monthKey, revenueMonthKey } from '../lib/stats'
import { fmtInZone, PK_ZONE } from '../lib/time'
import { isOverdue, isDueToday } from '../lib/followups'

export default function Dashboard() {
  const { leads, rule, setDrill, loading, error, sequences, steps } = useAppData()
  const nav = useNavigate()

  // Period filter. Lead-intake metrics scope by created date (day granularity);
  // won money (sales/collections/revenue) scopes by revenue month (month granularity).
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const fromMonth = from ? from.slice(0, 7) : ''
  const toMonth = to ? to.slice(0, 7) : ''
  const createdIn = (l: Lead): boolean => {
    if (!from && !to) return true
    const d = fmtInZone(l.created_utc, PK_ZONE, false)
    if (!d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }
  const revIn = (l: Lead): boolean => {
    if (!fromMonth && !toMonth) return true
    const k = revenueMonthKey(l)
    if (!k || k === 'unknown') return false
    if (fromMonth && k < fromMonth) return false
    if (toMonth && k > toMonth) return false
    return true
  }
  const setPeriod = (kind: 'all' | 'thisMonth' | 'last3' | 'thisYear') => {
    const p: Record<string, string> = {}
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: PK_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) if (x.type !== 'literal') p[x.type] = x.value
    const y = +p.year, m = +p.month
    const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    const today = `${p.year}-${p.month}-${p.day}`
    if (kind === 'all') { setFrom(''); setTo('') }
    else if (kind === 'thisMonth') { setFrom(iso(y, m, 1)); setTo(today) }
    else if (kind === 'last3') { let mm = m - 2, yy = y; while (mm < 1) { mm += 12; yy-- } setFrom(iso(yy, mm, 1)); setTo(today) }
    else if (kind === 'thisYear') { setFrom(iso(y, 1, 1)); setTo(today) }
  }

  const go = (label: string, test: Drill['test']) => { setDrill({ label, test }); nav('/leads') }

  const stats = useMemo(() => {
    const createdSet = leads.filter(createdIn)                              // lead-intake basis (created date)
    const wonSet = leads.filter((l) => isWon(l.stage) && revIn(l))          // won money basis (revenue month)
    const demos = createdSet.filter((l) => isDemo(l.stage)).length
    const seo = createdSet.filter((l) => l.source.toLowerCase() === 'seo').length
    const ht = createdSet.filter((l) => isHigh(l, rule)).length
    const wonMonthly = wonSet.reduce((s, l) => s + (ticketValue(l) || 0), 0)
    const revenueWon = wonSet.reduce((s, l) => s + leadRevenue(l), 0)
    const lostRevenue = createdSet.filter((l) => !isWon(l.stage) && ticketValue(l) != null).reduce((s, l) => s + leadRevenue(l), 0)
    const months = monthlyStats(leads, rule, { createdIn, wonIn: revIn })
    const bySrc: Record<string, number> = {}
    createdSet.forEach((l) => { bySrc[l.source] = (bySrc[l.source] || 0) + 1 })
    const bySrcSales: Record<string, { sales: number; coll: number; rev: number }> = {}
    wonSet.forEach((l) => {
      if (!bySrcSales[l.source]) bySrcSales[l.source] = { sales: 0, coll: 0, rev: 0 }
      const g = bySrcSales[l.source]; g.sales++; g.coll += ticketValue(l) || 0; g.rev += leadRevenue(l)
    })
    const sp: Record<string, { leads: number; demos: number; sales: number; ht: number; coll: number; rev: number }> = {}
    const ensureSp = (k: string) => { if (!sp[k]) sp[k] = { leads: 0, demos: 0, sales: 0, ht: 0, coll: 0, rev: 0 }; return sp[k] }
    createdSet.forEach((l) => { const g = ensureSp(specKey(l)); g.leads++; if (isDemo(l.stage)) g.demos++; if (isHigh(l, rule)) g.ht++ })
    wonSet.forEach((l) => { const g = ensureSp(specKey(l)); g.sales++; g.coll += ticketValue(l) || 0; g.rev += leadRevenue(l) })
    return { totalLeads: createdSet.length, demos, wons: wonSet.length, ht, seo, wonMonthly, revenueWon, lostRevenue, months,
      srcRows: Object.entries(bySrc).sort((a, b) => b[1] - a[1]),
      srcSalesRows: Object.entries(bySrcSales).sort((a, b) => b[1].sales - a[1].sales),
      spRows: Object.entries(sp).sort((a, b) => b[1].leads - a[1].leads) }
  }, [leads, rule, from, to])

  // Must run on every render, before any early return below — a hook called
  // conditionally (e.g. only once loading/error/empty have passed) makes this
  // component call a different number of hooks between renders, which React
  // treats as a hard error and unmounts the whole tree with no way to catch it.
  const followUpsDue = useMemo(() =>
    steps.filter((s) => {
      const seq = sequences.find((sq) => sq.id === s.sequence_id)
      return seq?.status === 'active' && (isOverdue(s) || isDueToday(s))
    }).length,
    [steps, sequences],
  )

  if (loading) return <div className="center-msg">Loading leads…</div>
  if (error) return <div className="note err">{error}</div>
  if (!leads.length)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <p className="muted">No leads yet. Go to <b>Upload</b> and import your Zoho CRM export.</p>
        <button className="btn" onClick={() => nav('/upload')}>Upload CRM export</button>
      </div>
    )

  const { totalLeads, demos, wons, ht, seo, wonMonthly, revenueWon, lostRevenue, months, srcRows, srcSalesRows, spRows } = stats
  const totalWon = wons
  const isSeo = (l: Lead) => l.source.toLowerCase() === 'seo'
  const hasData = totalLeads > 0 || wons > 0

  const kpis: [string, string | number, string, () => void][] = [
    ['Total leads', totalLeads, 'came in this period', () => go('Leads in period', (l) => createdIn(l))],
    ['SEO leads', seo, pct(seo, totalLeads) + ' of leads', () => go('SEO leads in period', (l) => createdIn(l) && isSeo(l))],
    ['Demos', demos, pct(demos, totalLeads) + ' of leads', () => go('Demos (reached demo+)', (l) => createdIn(l) && isDemo(l.stage))],
    ['Sales (Won)', wons, pct(wons, demos) + ' of demos', () => go('Sales — Won (this period)', (l) => isWon(l.stage) && revIn(l))],
    ['Won collections /mo', fmtMoney(wonMonthly), 'recognized this period', () => go('Won leads (this period)', (l) => isWon(l.stage) && revIn(l))],
    ['Revenue /mo (won)', fmtMoney(revenueWon), 'our charge % of won collections', () => go('Won leads (this period)', (l) => isWon(l.stage) && revIn(l))],
    ['Lost revenue /mo', fmtMoney(lostRevenue), 'charge % of non-won collections', () => go('Non-won leads with a collection', (l) => createdIn(l) && !isWon(l.stage) && ticketValue(l) != null)],
    ['High-ticket', ht, pct(ht, totalLeads) + ' of leads', () => go('High-ticket leads', (l) => createdIn(l) && isHigh(l, rule))],
    ['Follow-ups due', followUpsDue, 'overdue or due today', () => nav('/follow-ups')],
  ]

  return (
    <>
      <div className="controls filters">
        <span className="small muted" style={{ fontWeight: 700 }}>Period:</span>
        <button className="btn ghost" onClick={() => setPeriod('all')}>All time</button>
        <button className="btn ghost" onClick={() => setPeriod('thisMonth')}>This month</button>
        <button className="btn ghost" onClick={() => setPeriod('last3')}>Last 3 months</button>
        <button className="btn ghost" onClick={() => setPeriod('thisYear')}>This year</button>
        <span className="datef small muted">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></span>
        <span className="datef small muted">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></span>
        {(from || to) && <button className="btn ghost" onClick={() => setPeriod('all')}>Clear</button>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {from || to ? `${from || '…'} → ${to || '…'} · ` : ''}{totalLeads} of {leads.length} leads
        </span>
      </div>
      <div className="controls">
        <span className="small muted">
          High-ticket: <b>{ruleLabel(rule)}</b> (or manual ⭐) — change in <a onClick={() => nav('/admin')} style={{ cursor: 'pointer' }}>Admin</a>
          {(from || to) && <> · Leads by <b>created date</b>; Sales/Collections/Revenue by <b>revenue month</b></>}
        </span>
      </div>
      {!hasData && <div className="note">No data in this period. Adjust the dates or pick <b>All time</b>.</div>}

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
            <thead><tr><th>Month</th><th className="right">Leads</th><th className="right">Demos</th><th className="right">Sales</th><th className="right">Collections</th><th className="right">Revenue</th><th className="right">High-ticket</th><th className="right">Leads→Demos</th><th className="right">Demos→Sales</th><th className="right">High-ticket %</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td className="right link" onClick={() => go('Leads · ' + m.label, (l) => createdIn(l) && monthKey(l) === m.key)}>{m.leads}</td>
                  <td className="right link" onClick={() => go('Demos · ' + m.label, (l) => createdIn(l) && monthKey(l) === m.key && isDemo(l.stage))}>{m.demos}</td>
                  <td className="right link" onClick={() => go('Sales · ' + m.label, (l) => isWon(l.stage) && revIn(l) && revenueMonthKey(l) === m.key)}>{m.sales}</td>
                  <td className="right" title="Collections recognized this month (won leads)">{fmtMoney(m.coll) || '—'}</td>
                  <td className="right" title="Our revenue = charge % of won collections">{fmtMoney(m.rev) || '—'}</td>
                  <td className="right link" onClick={() => go('High-ticket · ' + m.label, (l) => createdIn(l) && monthKey(l) === m.key && isHigh(l, rule))}>{m.ht}</td>
                  <td className="right">{pct(m.demos, m.leads)}</td>
                  <td className="right">{pct(m.sales, m.demos)}</td>
                  <td className="right">{pct(m.ht, m.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start', marginTop: 28 }}>
        <div>
          <h2 className="section">Lead source breakdown</h2>
          <div className="card">
            <table>
              <thead><tr><th>Source</th><th className="right">Leads</th><th className="right">Share</th></tr></thead>
              <tbody>
                {srcRows.map(([s, c]) => (
                  <tr className="link" key={s} onClick={() => go('Source: ' + s, (l) => createdIn(l) && l.source === s)}>
                    <td>{s}</td><td className="right">{c}</td><td className="right">{pct(c, totalLeads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section">Sales by source</h2>
          <div className="card">
            <table>
              <thead><tr><th>Source</th><th className="right">Sales</th><th className="right">Revenue</th><th className="right">Share</th></tr></thead>
              <tbody>
                {srcSalesRows.length === 0 ? (
                  <tr><td colSpan={4} className="muted small">No closed (won) leads yet.</td></tr>
                ) : srcSalesRows.map(([s, v]) => (
                  <tr className="link" key={s} onClick={() => go('Won · ' + s, (l) => isWon(l.stage) && revIn(l) && l.source === s)}>
                    <td>{s}</td><td className="right">{v.sales}</td><td className="right">{fmtMoney(v.rev) || '—'}</td><td className="right">{pct(v.sales, totalWon)}</td>
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
                <thead><tr><th>Specialty</th><th className="right">Leads</th><th className="right">Demos</th><th className="right">Sales</th><th className="right">Collections</th><th className="right">Revenue</th><th className="right">High</th><th className="right">L→D</th><th className="right">D→S</th></tr></thead>
                <tbody>
                  {spRows.map(([s, v]) => (
                    <tr key={s}>
                      <td className="link" onClick={() => go('Specialty: ' + s, (l) => createdIn(l) && specKey(l) === s)}>{s}</td>
                      <td className="right link" onClick={() => go('Specialty: ' + s, (l) => createdIn(l) && specKey(l) === s)}>{v.leads}</td>
                      <td className="right link" onClick={() => go('Demos · ' + s, (l) => createdIn(l) && specKey(l) === s && isDemo(l.stage))}>{v.demos}</td>
                      <td className="right link" onClick={() => go('Sales · ' + s, (l) => isWon(l.stage) && revIn(l) && specKey(l) === s)}>{v.sales}</td>
                      <td className="right" title="Collections from closed (won) leads">{fmtMoney(v.coll) || '—'}</td>
                      <td className="right" title="Our revenue = charge % of won collections">{fmtMoney(v.rev) || '—'}</td>
                      <td className="right link" onClick={() => go('High-ticket · ' + s, (l) => createdIn(l) && specKey(l) === s && isHigh(l, rule))}>{v.ht}</td>
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
