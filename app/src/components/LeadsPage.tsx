import { Fragment, useMemo, useReducer, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import { useAppData } from '../data/AppData'
import { FUNNEL_ORDER } from '../lib/funnel'
import { displayName, effectiveNotes, fmtMoney, isHigh, num, ticketValue, type Lead } from '../lib/leads'
import { fmtInZone, PK_ZONE, SRC_ZONE } from '../lib/time'
import MultiSelect from './MultiSelect'

const COLS = [
  { key: 'name', label: 'Name', w: 180 },
  { key: 'practice', label: 'Practice', w: 150 },
  { key: 'specialty', label: 'Specialty', w: 120 },
  { key: 'physicians', label: 'Physicians', w: 85 },
  { key: 'source', label: 'Source', w: 90 },
  { key: 'status', label: 'Status', w: 135 },
  { key: 'stage', label: 'Stage', w: 95 },
  { key: 'created', label: 'Created (PK / US)', w: 165 },
  { key: 'ticket', label: 'Ticket $/mo', w: 95 },
  { key: 'high', label: 'High', w: 46 },
  { key: 'notes', label: 'Notes', w: 240 },
] as const

const LS_LAYOUT = 'transcure_layout_v3'
interface Layout { col: Record<string, number>; row: Record<string, number>; wrap: boolean }
function loadLayout(): Layout {
  try { const o = JSON.parse(localStorage.getItem(LS_LAYOUT) || '{}'); return { col: o.col || {}, row: o.row || {}, wrap: !!o.wrap } } catch { return { col: {}, row: {}, wrap: false } }
}

export default function LeadsPage() {
  const { leads, rule, updateManual, drill, setDrill } = useAppData()
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [fSource, setFSource] = useState<string[]>([])
  const [fStage, setFStage] = useState<string[]>([])
  const [fStatus, setFStatus] = useState<string[]>([])
  const [fSpecialty, setFSpecialty] = useState<string[]>([])
  const [fPhysicians, setFPhysicians] = useState<string[]>([])
  const [fTicketMin, setFTicketMin] = useState('')
  const [fTicketMax, setFTicketMax] = useState('')
  const [fHigh, setFHigh] = useState<'all' | 'high' | 'low'>('all')
  const [sortKey, setSortKey] = useState('created')
  const [sortDir, setSortDir] = useState(-1)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const layout = useRef<Layout>(loadLayout())
  const [, force] = useReducer((x) => x + 1, 0)
  const tableRef = useRef<HTMLTableElement>(null)

  const saveLayout = () => localStorage.setItem(LS_LAYOUT, JSON.stringify(layout.current))

  const clearDropdownsAndDrill = (cb: () => void) => { setDrill(null); cb() }

  const sources = useMemo(() => [...new Set(leads.map((l) => l.source))].sort(), [leads])
  const statuses = useMemo(() => [...new Set(leads.map((l) => l.status).filter(Boolean))].sort(), [leads])
  const specialties = useMemo(() => [...new Set(leads.map((l) => (l.specialty || '').trim()).filter(Boolean))].sort(), [leads])
  const physiciansOpts = useMemo(() => [...new Set(leads.map((l) => l.physicians || '').filter(Boolean))].sort(), [leads])

  const rows = useMemo(() => {
    let base = drill ? leads.filter(drill.test) : leads.filter((l) => {
      if (dateFrom || dateTo) { const d = fmtInZone(l.created_utc, PK_ZONE, false); if (dateFrom && (!d || d < dateFrom)) return false; if (dateTo && (!d || d > dateTo)) return false }
      if (fSource.length && !fSource.includes(l.source)) return false
      if (fStage.length && !fStage.includes(l.stage)) return false
      if (fStatus.length && !fStatus.includes(l.status)) return false
      if (fSpecialty.length && !fSpecialty.includes((l.specialty || '').trim())) return false
      if (fPhysicians.length && !fPhysicians.includes(l.physicians || '')) return false
      if (fHigh === 'high' && !isHigh(l, rule)) return false
      if (fHigh === 'low' && isHigh(l, rule)) return false
      const tv = ticketValue(l)
      if (fTicketMin !== '' && (tv == null || tv < Number(fTicketMin))) return false
      if (fTicketMax !== '' && (tv == null || tv > Number(fTicketMax))) return false
      return true
    })
    if (q.trim()) {
      const s = q.toLowerCase().trim()
      base = base.filter((l) => (displayName(l) + ' ' + (l.practice || '') + ' ' + (l.email || '') + ' ' + (l.specialty || '') + ' ' + effectiveNotes(l)).toLowerCase().includes(s))
    }
    const val = (l: Lead): string | number => {
      switch (sortKey) {
        case 'name': return displayName(l).toLowerCase()
        case 'created': return l.created_utc || ''
        case 'ticket': return ticketValue(l) || 0
        case 'high': return isHigh(l, rule) ? 1 : 0
        default: return String((l as unknown as Record<string, unknown>)[sortKey] ?? '').toLowerCase()
      }
    }
    return [...base].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -sortDir : va > vb ? sortDir : 0 })
  }, [leads, drill, q, dateFrom, dateTo, fSource, fStage, fStatus, fSpecialty, fPhysicians, fTicketMin, fTicketMax, fHigh, sortKey, sortDir, rule])

  const setSort = (k: string) => { if (sortKey === k) setSortDir((d) => -d); else { setSortKey(k); setSortDir(1) } }

  const startColResize = (e: RMouseEvent, key: string) => {
    e.preventDefault(); e.stopPropagation()
    const table = (e.currentTarget as HTMLElement).closest('table')!
    const idx = COLS.findIndex((c) => c.key === key)
    const col = table.querySelectorAll('colgroup col')[idx] as HTMLElement
    const startX = e.clientX, startW = col.getBoundingClientRect().width
    const mm = (ev: MouseEvent) => { const w = Math.max(40, Math.round(startW + ev.clientX - startX)); col.style.width = w + 'px'; layout.current.col[key] = w }
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); saveLayout() }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
  }
  const startRowResize = (e: RMouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation()
    const tr = (e.currentTarget as HTMLElement).closest('tr')!
    const startY = e.clientY, startH = tr.getBoundingClientRect().height
    const mm = (ev: MouseEvent) => { const h = Math.max(28, Math.round(startH + ev.clientY - startY)); tr.style.height = h + 'px'; layout.current.row[id] = h }
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); saveLayout() }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
  }
  const toggleWrap = () => { layout.current.wrap = !layout.current.wrap; saveLayout(); force() }
  const resetLayout = () => { layout.current = { col: {}, row: {}, wrap: false }; saveLayout(); force() }

  const toggleHigh = (l: Lead) => {
    const next = l.manual_high === true ? false : l.manual_high === false ? null : true
    updateManual(l.record_id, { manual_high: next })
  }
  const toggleOpen = (id: string) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const orNull = (v: string) => (v.trim() === '' ? null : v)

  const clearFilters = () => {
    setDrill(null); setQ(''); setDateFrom(''); setDateTo(''); setFSource([]); setFStage([]); setFStatus([])
    setFSpecialty([]); setFPhysicians([]); setFTicketMin(''); setFTicketMax(''); setFHigh('all')
  }
  const activeCount =
    [q, dateFrom, dateTo, fTicketMin, fTicketMax].filter(Boolean).length +
    [fSource, fStage, fStatus, fSpecialty, fPhysicians].filter((a) => a.length).length +
    (fHigh !== 'all' ? 1 : 0)
  const pick = (set: (v: string[]) => void) => (v: string[]) => clearDropdownsAndDrill(() => set(v))

  return (
    <>
      <div className="controls">
        <input type="text" placeholder="Search name, practice, email, notes…" style={{ minWidth: 240 }} value={q} onChange={(e) => clearDropdownsAndDrill(() => setQ(e.target.value))} />
        <label className="small muted"><input type="checkbox" checked={layout.current.wrap} onChange={toggleWrap} /> Wrap text</label>
        <button className="btn ghost" onClick={resetLayout} style={{ padding: '6px 12px' }}>Reset layout</button>
        <div className="small muted" style={{ marginLeft: 'auto' }}>{rows.length} shown{activeCount ? ` · ${activeCount} filter${activeCount > 1 ? 's' : ''} active` : ''}</div>
      </div>

      <div className="controls filters">
        <span className="small muted" style={{ fontWeight: 700 }}>Filters:</span>
        <span className="datef small muted">From <input type="date" value={dateFrom} onChange={(e) => clearDropdownsAndDrill(() => setDateFrom(e.target.value))} /></span>
        <span className="datef small muted">To <input type="date" value={dateTo} onChange={(e) => clearDropdownsAndDrill(() => setDateTo(e.target.value))} /></span>
        <MultiSelect label="Source" options={sources} selected={fSource} onChange={pick(setFSource)} />
        <MultiSelect label="Stage" options={[...FUNNEL_ORDER]} selected={fStage} onChange={pick(setFStage)} />
        <MultiSelect label="Status" options={statuses} selected={fStatus} onChange={pick(setFStatus)} />
        <MultiSelect label="Specialty" options={specialties} selected={fSpecialty} onChange={pick(setFSpecialty)} />
        <MultiSelect label="Size" options={physiciansOpts} selected={fPhysicians} onChange={pick(setFPhysicians)} />
        <input type="number" placeholder="Ticket min $" style={{ width: 115 }} value={fTicketMin} onChange={(e) => clearDropdownsAndDrill(() => setFTicketMin(e.target.value))} />
        <input type="number" placeholder="Ticket max $" style={{ width: 115 }} value={fTicketMax} onChange={(e) => clearDropdownsAndDrill(() => setFTicketMax(e.target.value))} />
        <select value={fHigh} onChange={(e) => clearDropdownsAndDrill(() => setFHigh(e.target.value as 'all' | 'high' | 'low'))}>
          <option value="all">High: all</option>
          <option value="high">High-ticket only</option>
          <option value="low">Non high-ticket</option>
        </select>
        <button className="btn ghost" onClick={clearFilters} disabled={!activeCount && !drill} style={{ padding: '6px 12px' }}>Clear filters</button>
      </div>

      {drill && (
        <div id="drillBanner" className="note">
          Showing <b>{drill.label}</b> — {rows.length} lead(s). <a onClick={() => setDrill(null)}>Show all leads</a>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table id="leadsTable" className={layout.current.wrap ? 'wrap' : ''} ref={tableRef}>
            <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: (layout.current.col[c.key] || c.w) + 'px' }} />)}</colgroup>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className="sortable" onClick={() => setSort(c.key)}>
                    {c.label}{sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                    <div className="colgrip" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => startColResize(e, c.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <Fragment key={l.record_id}>
                <tr style={layout.current.row[l.record_id] ? { height: layout.current.row[l.record_id] + 'px' } : undefined}>
                  <td>
                    <button className="expander" title="Source tracking details" onClick={() => toggleOpen(l.record_id)}>{open.has(l.record_id) ? '▾' : '▸'}</button>
                    <b>{displayName(l)}</b>
                    <div className="small muted">{l.email}</div>
                    <div className="rowgrip" onMouseDown={(e) => startRowResize(e, l.record_id)} />
                  </td>
                  <td>{l.practice}</td>
                  <td>{l.specialty}</td>
                  <td>{l.physicians}</td>
                  <td>{l.source}</td>
                  <td>{l.status}</td>
                  <td><span className={'chip stage-' + l.stage}>{l.stage}</span></td>
                  <td className="timecell">{fmtInZone(l.created_utc, PK_ZONE) || '—'}<div className="us">{fmtInZone(l.created_utc, SRC_ZONE)} US</div></td>
                  <td>
                    <input className="cell" type="text" defaultValue={l.manual_ticket != null ? String(l.manual_ticket) : ''}
                      placeholder={l.monthly_collections != null ? fmtMoney(l.monthly_collections) : '—'}
                      title={l.monthly_collections != null ? 'CRM Monthly Collections: ' + fmtMoney(l.monthly_collections) : 'no CRM value'}
                      onBlur={(e) => updateManual(l.record_id, { manual_ticket: e.target.value.trim() === '' ? null : num(e.target.value) })} />
                  </td>
                  <td className="right"><span className="flag" title="toggle high-ticket" onClick={() => toggleHigh(l)}>{isHigh(l, rule) ? '⭐' : '☆'}</span></td>
                  <td className="notes">
                    <textarea className="notecell" rows={2} defaultValue={effectiveNotes(l)} placeholder="add note…" title="Drag the bottom edge to expand"
                      onBlur={(e) => updateManual(l.record_id, { manual_notes: e.target.value })} />
                  </td>
                </tr>
                {open.has(l.record_id) && (
                  <tr className="detailrow">
                    <td colSpan={COLS.length}>
                      <div className="detail">
                        <div className="detail-head">Source tracking — {displayName(l)}</div>
                        <div className="detail-grid">
                          <label>Source / Medium
                            <input defaultValue={l.manual_source_medium ?? ''} placeholder={l.referrer ? 'CRM referrer: ' + l.referrer : 'e.g. Google / Organic'}
                              onBlur={(e) => updateManual(l.record_id, { manual_source_medium: orNull(e.target.value) })} /></label>
                          <label>First landing page
                            <input defaultValue={l.manual_first_landing ?? ''} placeholder={l.first_page || 'https://…'}
                              onBlur={(e) => updateManual(l.record_id, { manual_first_landing: orNull(e.target.value) })} /></label>
                          <label>2nd page
                            <input defaultValue={l.manual_second_page ?? ''} placeholder="https://…"
                              onBlur={(e) => updateManual(l.record_id, { manual_second_page: orNull(e.target.value) })} /></label>
                          <label>Lead submit page
                            <input defaultValue={l.manual_submit_page ?? ''} placeholder="page the form was submitted on"
                              onBlur={(e) => updateManual(l.record_id, { manual_submit_page: orNull(e.target.value) })} /></label>
                          <label>Recording (Hotjar) link
                            <input type="url" defaultValue={l.manual_recording ?? ''} placeholder="https://insights.hotjar.com/…"
                              onBlur={(e) => updateManual(l.record_id, { manual_recording: orNull(e.target.value) })} /></label>
                          <label className="wide">Possible search query
                            <textarea rows={2} defaultValue={l.manual_search_query ?? ''} placeholder="keywords the lead likely searched"
                              onBlur={(e) => updateManual(l.record_id, { manual_search_query: orNull(e.target.value) })} /></label>
                        </div>
                        <div className="detail-ref small muted">
                          CRM First Page Visited: <b>{l.first_page || '—'}</b> · Referrer: <b>{l.referrer || '—'}</b>
                          {l.manual_recording && <> · <a href={l.manual_recording} target="_blank" rel="noreferrer">open recording ↗</a></>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Times shown as <b>PK</b> with <span className="us">US Chicago</span> beneath. Ticket / High / Notes are saved to the shared database and preserved across imports.
      </p>
    </>
  )
}
