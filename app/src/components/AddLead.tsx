import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useAppData } from '../data/AppData'
import { stageFor } from '../lib/funnel'
import { num, type Lead } from '../lib/leads'

const STATUS_SUGGESTIONS = ['Attempted to Contact', 'Contacted', 'Follow Up', 'Contact in Future', 'Demo Scheduled', 'Demo Completed', 'Under Audit', 'Agreement Sent', 'Won Lead', 'Lost Lead', 'Not-Qualified', 'Junk Lead']

const EMPTY = { name: '', email: '', phone: '', practice: '', specialty: '', physicians: '', source: 'SEO', status: 'Attempted to Contact', monthly: '', date: '' }

export default function AddLead() {
  const { addLead } = useAppData()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ ...EMPTY })
  const set = (k: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  const close = () => { if (!busy) { setOpen(false); setErr(null) } }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) { setErr('Name is required.'); return }
    setBusy(true); setErr(null)
    try {
      const created = (f.date ? new Date(f.date + 'T12:00:00Z') : new Date()).toISOString()
      const lead: Lead = {
        record_id: 'manual-' + crypto.randomUUID(),
        lead_owner: null, company: f.practice.trim() || null,
        first_name: null, last_name: null, lead_name: f.name.trim(),
        email: f.email.trim() || null, phone: f.phone.trim() || null,
        source: f.source.trim() || '(blank)', status: f.status.trim(), stage: stageFor(f.status),
        tag: null, specialty: f.specialty.trim() || null, practice: f.practice.trim() || null,
        physicians: f.physicians.trim() || null, monthly_collections: num(f.monthly),
        first_page: null, referrer: null, message: null, comments: null, phase: null,
        created_utc: created, modified_utc: created, raw: null,
        manual_ticket: null, manual_high: null, manual_notes: null,
        manual_source_medium: null, manual_first_landing: null, manual_second_page: null,
        manual_submit_page: null, manual_search_query: null, manual_recording: null, manual_charge_pct: null,
      }
      await addLead(lead)
      setF({ ...EMPTY })
      setOpen(false)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>+ Add lead</button>
      {open && (
        <div className="modal-overlay" onClick={close}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2 className="section" style={{ marginTop: 0 }}>Add lead</h2>
            <div className="form-grid">
              <label className="wide">Name *<input value={f.name} onChange={set('name')} autoFocus /></label>
              <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
              <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
              <label>Practice<input value={f.practice} onChange={set('practice')} /></label>
              <label>Specialty<input value={f.specialty} onChange={set('specialty')} /></label>
              <label>Physicians<input value={f.physicians} onChange={set('physicians')} placeholder="e.g. 2-5" /></label>
              <label>Source<input value={f.source} onChange={set('source')} /></label>
              <label>Status<input list="status-suggest" value={f.status} onChange={set('status')} /><datalist id="status-suggest">{STATUS_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist></label>
              <label>Monthly collections $<input type="number" value={f.monthly} onChange={set('monthly')} /></label>
              <label>Created date<input type="date" value={f.date} onChange={set('date')} /></label>
            </div>
            {err && <div className="note err">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Add lead'}</button>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Source-tracking fields can be added after, via the ▸ expander on the lead row. Manually-added leads are kept separate from CSV imports.</p>
          </form>
        </div>
      )}
    </>
  )
}
