import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../data/AppData'
import { parseCSV, rowsToObjects, toCSV } from '../lib/csv'
import { csvRowToLead, displayName, effectiveNotes, fmtMoney, isHigh, ticketValue } from '../lib/leads'
import { fetchImportBatches, importLeads, reapplyBatch, type ImportBatch } from '../lib/api'
import { fmtInZone, PK_ZONE, SRC_ZONE } from '../lib/time'

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return (o.message || o.details || o.hint || o.error_description || JSON.stringify(o)) as string
  }
  return String(e)
}

export default function Upload() {
  const { leads, rule, refresh } = useAppData()
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [batches, setBatches] = useState<ImportBatch[]>([])

  const loadBatches = () => fetchImportBatches().then(setBatches).catch(() => {})
  useEffect(() => { loadBatches() }, [])

  const handleFile = (f: File) => {
    setBusy(true)
    setMsg(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const objs = rowsToObjects(parseCSV(String(e.target?.result || '')))
        if (!objs.length || !('Record Id' in objs[0])) {
          setMsg({ kind: 'err', text: 'That file has no "Record Id" column — is it the Zoho Leads export?' })
          setBusy(false)
          return
        }
        const crm = objs.map(csvRowToLead).filter((r) => r.record_id)
        const res = await importLeads(crm, f.name)
        await refresh()
        await loadBatches()
        setMsg({ kind: 'ok', text: `Imported ${res.total} rows · ${res.inserted} new · ${res.updated} updated.` })
      } catch (err) {
        setMsg({ kind: 'err', text: errMsg(err) })
      } finally {
        setBusy(false)
      }
    }
    reader.readAsText(f)
  }

  const reapply = async (b: ImportBatch) => {
    const when = fmtInZone(b.uploaded_at, PK_ZONE)
    if (!window.confirm(`Re-apply the import "${b.file_name ?? 'import'}" from ${when} PK?\n\nThis re-upserts that version's ${b.rows_total ?? '?'} rows by Record Id. Your manual edits (ticket, notes, source tracking) are kept. Leads added in later imports are not removed.`)) return
    setBusy(true); setMsg(null)
    try {
      const res = await reapplyBatch(b.id)
      await refresh()
      await loadBatches()
      setMsg({ kind: 'ok', text: `Re-applied ${res.total} rows from "${b.file_name ?? 'import'}" · ${res.updated} updated · ${res.inserted} re-added.` })
    } catch (err) {
      setMsg({ kind: 'err', text: errMsg(err) })
    } finally {
      setBusy(false)
    }
  }

  const exportEnriched = () => {
    const rows = leads.map((l) => ({
      'Record Id': l.record_id, Name: displayName(l), Email: l.email, Phone: l.phone, Practice: l.practice,
      Specialty: l.specialty, Physicians: l.physicians, Source: l.source, Status: l.status, Stage: l.stage,
      'Created PK': fmtInZone(l.created_utc, PK_ZONE), 'Created US': fmtInZone(l.created_utc, SRC_ZONE),
      'Monthly Collections (CRM)': l.monthly_collections, 'Ticket $/mo': ticketValue(l),
      'High Ticket': isHigh(l, rule) ? 'Yes' : 'No', Notes: effectiveNotes(l),
      'Source/Medium': l.manual_source_medium, 'First Landing Page': l.manual_first_landing ?? l.first_page,
      '2nd Page': l.manual_second_page, 'Lead Submit Page': l.manual_submit_page,
      'Possible Search Query': l.manual_search_query, 'Recording': l.manual_recording,
    }))
    if (!rows.length) return
    const blob = new Blob([toCSV(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'transcure_enriched_leads.csv'
    a.click()
  }

  return (
    <>
    <div className="card">
      <h2 className="section">Upload Zoho CRM export</h2>
      <div className="note">Re-uploading a newer export <b>updates existing leads by Record Id</b> and adds new ones — no duplicates. Your manual edits (ticket size, High-ticket, notes) are preserved.</div>
      <div
        className={'drop' + (drag ? ' drag' : '')}
        onClick={() => fileRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setDrag(true) }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDrag(false) }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
      >
        <p style={{ fontSize: 16, margin: '0 0 6px' }}><b>{busy ? 'Importing…' : 'Drop CSV here'}</b>{!busy && ' or click to choose'}</p>
        <p className="small muted" style={{ margin: 0 }}>Expects the Zoho Leads export (the file with a <code>Record Id</code> column).</p>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
      </div>
      {msg && <div className={'note ' + (msg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 14 }}>{msg.text}</div>}
      <div style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={exportEnriched}>Export enriched CSV</button>
      </div>
    </div>

    <h2 className="section">Import history</h2>
    <div className="card" style={{ padding: 0 }}>
      <div className="tablewrap" style={{ maxHeight: 360 }}>
        <table>
          <thead><tr><th>Imported (PK)</th><th>File</th><th className="right">Rows</th><th className="right">New</th><th className="right">Updated</th><th></th></tr></thead>
          <tbody>
            {batches.length === 0 ? (
              <tr><td colSpan={6} className="muted small" style={{ padding: 14 }}>No imports yet.</td></tr>
            ) : batches.map((b) => (
              <tr key={b.id}>
                <td className="timecell">{fmtInZone(b.uploaded_at, PK_ZONE)}</td>
                <td>{b.file_name || '—'}</td>
                <td className="right">{b.rows_total ?? '—'}</td>
                <td className="right">{b.rows_inserted ?? '—'}</td>
                <td className="right">{b.rows_updated ?? '—'}</td>
                <td className="right"><button className="btn ghost" disabled={busy} style={{ padding: '4px 10px' }} onClick={() => reapply(b)}>Re-apply</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <p className="small muted" style={{ marginTop: 8 }}>
      Each import stores its full row set. <b>Re-apply</b> restores that version's CRM data (matched by Record Id); your manual edits are always preserved. It logs a new history entry, so you can move between versions freely.
    </p>
    </>
  )
}
