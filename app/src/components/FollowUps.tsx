import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../data/AppData'
import {
  CHANNEL_ICON, allDone, effectiveEmail, isOverdue, isDueToday,
  isChannelDone, pendingChannels, stepComplete, nextPending, todayIso,
  type FollowUpSequence, type FollowUpStep,
} from '../lib/followups'
import { displayName, type Lead } from '../lib/leads'
import StageChip from './StageChip'
import MultiSelect from './MultiSelect'
import { downloadCSV } from '../lib/csv'

interface SeqRow {
  seq: FollowUpSequence
  lead: Lead | null
  steps: FollowUpStep[]
  /** Channels ticked off across all 5 weeks, and the total. */
  doneChannels: number
  totalChannels: number
  next: FollowUpStep | null
  /** Days the next outstanding step is past due; 0 if due today or later. */
  overdueDays: number
  finished: boolean
  /** Derived labels, computed once so filtering and sorting agree. */
  dueState: DueState
  statusLabel: StatusLabel
  effEmail: string
}

type DueState = 'Overdue' | 'Due today' | 'Upcoming' | 'Complete'
type StatusLabel = 'Active' | 'Awaiting decision' | 'Won' | 'Lost'

const DUE_STATES: DueState[] = ['Overdue', 'Due today', 'Upcoming', 'Complete']
const STATUS_LABELS: StatusLabel[] = ['Active', 'Awaiting decision', 'Won', 'Lost']
const WEEKS = ['1', '2', '3', '4', '5']

const SORTS = [
  { key: 'urgency', label: 'Priority' },
  { key: 'lead', label: 'Lead' },
  { key: 'stage', label: 'Stage' },
  { key: 'progress', label: 'Progress' },
  { key: 'due', label: 'Next due' },
  { key: 'email', label: 'Reminder email' },
  { key: 'status', label: 'Status' },
] as const

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

/**
 * One flat CSV record per lead, mirroring what the table shows plus a column
 * pair per week — so an export of a filtered view is self-explanatory without
 * having to cross-reference the app.
 */
function followUpExportRow(r: SeqRow): Record<string, unknown> {
  const l = r.lead
  const row: Record<string, unknown> = {
    Lead: l ? displayName(l) : r.seq.lead_record_id,
    Practice: l?.practice ?? '',
    Email: l?.email ?? '',
    Phone: l?.phone ?? '',
    Specialty: l?.specialty ?? '',
    Stage: l?.stage ?? '',
    'Sequence status': r.statusLabel,
    'Due state': r.dueState,
    'Next week': r.next?.step_number ?? '',
    'Next due': r.next?.scheduled_date ?? '',
    'Days overdue': r.overdueDays || '',
    'Channels done': r.doneChannels,
    'Channels total': r.totalChannels,
    'Progress %': r.totalChannels ? Math.round((r.doneChannels / r.totalChannels) * 100) : 0,
    'Reminder email': r.effEmail,
    'Email source': (r.seq.manager_email ?? '').trim() ? 'custom' : 'default',
    Started: (r.seq.started_at ?? '').slice(0, 10),
  }
  // Fixed Week 1..5 columns regardless of how many steps a sequence has, so
  // every exported row lines up in the same spreadsheet columns.
  for (let n = 1; n <= 5; n++) {
    const step = r.steps.find((s) => s.step_number === n)
    row[`Week ${n} due`] = step?.scheduled_date ?? ''
    row[`Week ${n} outstanding`] = step ? pendingChannels(step).join(', ') : ''
  }
  return row
}

export default function FollowUps() {
  const {
    leads, sequences, steps, followUpError, managerEmail, automation, project,
    toggleChannel, completeStep, rescheduleStep, resolveSequence, changeSequenceEmail,
  } = useAppData()
  const nav = useNavigate()

  // Filters. An empty multi-select means "no restriction", matching how the
  // Leads page behaves. Status defaults to Active so the page still opens on the
  // work queue rather than every sequence ever created.
  const [fStatus, setFStatus] = useState<string[]>(['Active', 'Awaiting decision'])
  const [fDue, setFDue] = useState<string[]>([])
  const [fStage, setFStage] = useState<string[]>([])
  const [fWeek, setFWeek] = useState<string[]>([])
  const [fEmail, setFEmail] = useState<string[]>([])
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState<string>('urgency')
  const [sortDir, setSortDir] = useState(1)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [resolving, setResolving] = useState<SeqRow | null>(null)
  const [editingEmail, setEditingEmail] = useState<string | null>(null)
  const [editEmailVal, setEditEmailVal] = useState('')
  const [markingDone, setMarkingDone] = useState<{ stepId: string; seqId: string } | null>(null)
  const [doneNotes, setDoneNotes] = useState('')
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [busySeq, setBusySeq] = useState<string | null>(null)

  const leadMap = useMemo(() => new Map(leads.map((l) => [l.record_id, l])), [leads])

  const stepsBySeq = useMemo(() => {
    const m = new Map<string, FollowUpStep[]>()
    steps.forEach((s) => {
      if (!m.has(s.sequence_id)) m.set(s.sequence_id, [])
      m.get(s.sequence_id)!.push(s)
    })
    return m
  }, [steps])

  // Build every row once, with its derived labels, so the filters and the sort
  // agree on what "overdue" or "awaiting decision" means.
  const allRows: SeqRow[] = useMemo(() => {
    const today = todayIso()
    return sequences.map((seq) => {
      const lead = leadMap.get(seq.lead_record_id) ?? null
      const sSteps = (stepsBySeq.get(seq.id) ?? []).sort((a, b) => a.step_number - b.step_number)
      const totalChannels = sSteps.reduce((n, s) => n + s.channels.length, 0)
      const doneChannels = sSteps.reduce((n, s) => n + s.channels.filter((c) => isChannelDone(s, c)).length, 0)
      const next = nextPending(sSteps)
      const overdueDays = next && next.scheduled_date < today ? daysBetween(next.scheduled_date, today) : 0
      const finished = allDone(sSteps)

      const dueState: DueState = finished ? 'Complete'
        : overdueDays > 0 ? 'Overdue'
        : next && isDueToday(next) ? 'Due today'
        : 'Upcoming'

      const statusLabel: StatusLabel = seq.status === 'won' ? 'Won'
        : seq.status === 'lost' ? 'Lost'
        : finished ? 'Awaiting decision'
        : 'Active'

      return {
        seq, lead, steps: sSteps, doneChannels, totalChannels, next, overdueDays, finished,
        dueState, statusLabel, effEmail: effectiveEmail(seq, managerEmail),
      }
    })
  }, [sequences, leadMap, stepsBySeq, managerEmail])

  // Filter options are drawn from the rows themselves, so they only ever offer
  // values that would actually match something.
  const stageOpts = useMemo(
    () => [...new Set(allRows.map((r) => r.lead?.stage).filter(Boolean) as string[])].sort(),
    [allRows],
  )
  const emailOpts = useMemo(
    () => [...new Set(allRows.map((r) => r.effEmail).filter(Boolean))].sort(),
    [allRows],
  )

  const rows: SeqRow[] = useMemo(() => {
    const term = q.trim().toLowerCase()

    const filtered = allRows.filter((r) => {
      if (fStatus.length && !fStatus.includes(r.statusLabel)) return false
      if (fDue.length && !fDue.includes(r.dueState)) return false
      if (fStage.length && !fStage.includes(r.lead?.stage ?? '')) return false
      if (fWeek.length && !fWeek.includes(String(r.next?.step_number ?? ''))) return false
      if (fEmail.length && !fEmail.includes(r.effEmail)) return false
      if (dueFrom || dueTo) {
        const d = r.next?.scheduled_date
        if (!d) return false
        if (dueFrom && d < dueFrom) return false
        if (dueTo && d > dueTo) return false
      }
      if (term) {
        const l = r.lead
        const hay = [l ? displayName(l) : r.seq.lead_record_id, l?.practice, l?.email, l?.specialty, r.effEmail]
        if (!hay.some((v) => (v ?? '').toLowerCase().includes(term))) return false
      }
      return true
    })

    // 'urgency' is the work-queue order: resolved sequences sink to the bottom
    // (they need no action), then most overdue first, then those awaiting a
    // decision, then whatever falls due soonest.
    const urgency = (a: SeqRow, b: SeqRow): number => {
      const aDone = a.seq.status !== 'active'
      const bDone = b.seq.status !== 'active'
      if (aDone !== bDone) return aDone ? 1 : -1
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return (a.next?.scheduled_date ?? '9999-12-31').localeCompare(b.next?.scheduled_date ?? '9999-12-31')
    }

    const val = (r: SeqRow): string | number => {
      switch (sortKey) {
        case 'lead': return (r.lead ? displayName(r.lead) : r.seq.lead_record_id).toLowerCase()
        case 'stage': return (r.lead?.stage ?? '').toLowerCase()
        // Ratio rather than raw count, so leads with different channel totals compare fairly.
        case 'progress': return r.totalChannels ? r.doneChannels / r.totalChannels : 0
        case 'due': return r.next?.scheduled_date ?? '9999-12-31'
        case 'email': return r.effEmail.toLowerCase()
        case 'status': return r.statusLabel.toLowerCase()
        default: return 0
      }
    }

    return [...filtered].sort((a, b) => {
      if (sortKey === 'urgency') return urgency(a, b) * sortDir
      const va = val(a), vb = val(b)
      if (va < vb) return -sortDir
      if (va > vb) return sortDir
      return urgency(a, b)   // stable, useful tie-break
    })
  }, [allRows, q, fStatus, fDue, fStage, fWeek, fEmail, dueFrom, dueTo, sortKey, sortDir])

  const filtersOn = !!(q.trim() || fDue.length || fStage.length || fWeek.length || fEmail.length || dueFrom || dueTo
    || fStatus.length !== 2 || !fStatus.includes('Active') || !fStatus.includes('Awaiting decision'))

  const clearFilters = () => {
    setQ(''); setFStatus(['Active', 'Awaiting decision']); setFDue([]); setFStage([])
    setFWeek([]); setFEmail([]); setDueFrom(''); setDueTo('')
  }

  const setSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => -d)
    else { setSortKey(k); setSortDir(k === 'urgency' ? 1 : 1) }
  }
  const sortMark = (k: string) => (sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '')

  // Exports exactly what is on screen — the active filters and the current sort
  // order — rather than the whole workspace.
  const exportRows = () => {
    if (!rows.length) return
    const slug = filtersOn ? 'filtered' : 'all'
    downloadCSV(`${project.id}_follow_ups_${slug}_${todayIso()}.csv`, rows.map(followUpExportRow))
  }

  const dueCount = useMemo(() =>
    steps.filter((s) => {
      const seq = sequences.find((sq) => sq.id === s.sequence_id)
      return seq?.status === 'active' && (isOverdue(s) || isDueToday(s))
    }).length,
    [steps, sequences],
  )

  const overrideCount = useMemo(
    () => sequences.filter((s) => (s.manager_email ?? '').trim() !== '').length,
    [sequences],
  )

  const toggleOpen = (id: string) => setOpen((prev) => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const handleMarkDone = async () => {
    if (!markingDone) return
    setBusyStep(markingDone.stepId)
    try {
      await completeStep(markingDone.stepId, doneNotes.trim() || undefined)
    } catch (e) {
      alert('Could not mark step done: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusyStep(null); setMarkingDone(null); setDoneNotes('')
    }
  }

  const handleReschedule = async (stepId: string, date: string) => {
    setBusyStep(stepId)
    try {
      await rescheduleStep(stepId, date)
    } catch (e) {
      alert('Could not reschedule: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusyStep(null)
    }
  }

  const handleResolve = async (outcome: 'won' | 'lost') => {
    if (!resolving) return
    setBusySeq(resolving.seq.id)
    try {
      await resolveSequence(resolving.seq.id, outcome, resolving.seq.lead_record_id)
      setResolving(null)
    } catch (e) {
      alert('Could not resolve: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusySeq(null)
    }
  }

  // Blank clears the override so the sequence falls back to the Admin default.
  const saveEmail = async (seqId: string) => {
    const val = editEmailVal.trim()
    setBusySeq(seqId)
    try {
      await changeSequenceEmail(seqId, val === '' ? null : val)
      setEditingEmail(null)
    } catch (e) {
      alert('Could not update email: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusySeq(null)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Follow-Ups</h1>
        {dueCount > 0 && (
          <span style={{ background: 'var(--warn)', color: '#fff', borderRadius: 20, padding: '3px 11px', fontSize: 12, fontWeight: 700 }}>
            {dueCount} overdue / due today
          </span>
        )}
        <span className="small muted">
          {rows.length}{filtersOn && rows.length !== allRows.length ? ` of ${allRows.length}` : ''} lead{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="controls filters">
        <input type="text" placeholder="Search name, practice, email…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ width: 210 }} />
        <MultiSelect label="Status" options={STATUS_LABELS as unknown as string[]} selected={fStatus} onChange={setFStatus} />
        <MultiSelect label="Due" options={DUE_STATES as unknown as string[]} selected={fDue} onChange={setFDue} />
        <MultiSelect label="Stage" options={stageOpts} selected={fStage} onChange={setFStage} />
        <MultiSelect label="Next week" options={WEEKS} selected={fWeek} onChange={setFWeek} />
        <MultiSelect label="Reminder to" options={emailOpts} selected={fEmail} onChange={setFEmail} />
        <span className="datef small muted">
          Due from <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
        </span>
        <span className="datef small muted">
          to <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
        </span>
        <button className="btn ghost" onClick={clearFilters} disabled={!filtersOn}>Clear filters</button>
        <button className="btn" onClick={exportRows} disabled={!rows.length}
                title={filtersOn ? `Export the ${rows.length} row${rows.length === 1 ? '' : 's'} currently shown` : 'Export all rows'}>
          Export CSV{filtersOn && rows.length !== allRows.length ? ` (${rows.length})` : ''}
        </button>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          Sorted by <b>{SORTS.find((s) => s.key === sortKey)?.label}</b>{sortDir === 1 ? ' ▲' : ' ▼'}
        </span>
      </div>

      {followUpError && (
        <div className="note err" style={{ marginBottom: 16 }}>
          <b>Follow-up tables unavailable.</b> Your leads are unaffected, but sequences cannot load or be created until the
          migration is applied. Run <code>app/supabase/migrations/003_auto_reminders.sql</code> in the Supabase SQL Editor.
          <div className="small" style={{ marginTop: 6, opacity: .85 }}>Details: {followUpError}</div>
        </div>
      )}

      <div className="note" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {managerEmail.trim() ? (
          <>
            <span>
              {automation.enabled
                ? <>Daily reminder emails go out automatically at <b>{String(automation.digestHour).padStart(2, '0')}:00</b> to <b>{managerEmail}</b></>
                : <>Automatic reminders are <b>paused</b>. Recipient would be <b>{managerEmail}</b></>}
              {overrideCount > 0 && <> · {overrideCount} lead{overrideCount > 1 ? 's have' : ' has'} a custom address</>}
            </span>
            <a onClick={() => nav('/admin')} style={{ cursor: 'pointer', marginLeft: 'auto' }}>Change in Admin</a>
          </>
        ) : (
          <>
            <span><b>No lead-manager email set.</b> No reminders will be sent until you add one.</span>
            <a onClick={() => nav('/admin')} style={{ cursor: 'pointer', fontWeight: 700 }}>Set it in Admin →</a>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">
            {filtersOn ? 'No leads match these filters.' : 'No follow-up sequences.'}
          </p>
          {filtersOn
            ? <button className="btn ghost" onClick={clearFilters}>Clear filters</button>
            : <p className="small muted">Sequences are created automatically for every lead that reaches the workspace's follow-up stage.</p>}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap" style={{ maxHeight: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }} className="sortable" title="Sort by priority: most overdue first"
                      onClick={() => setSort('urgency')}>{sortKey === 'urgency' ? (sortDir === 1 ? '▲' : '▼') : '⇅'}</th>
                  <th className="sortable" onClick={() => setSort('lead')}>Lead{sortMark('lead')}</th>
                  <th style={{ width: 96 }} className="sortable" onClick={() => setSort('stage')}>Stage{sortMark('stage')}</th>
                  <th style={{ width: 150 }} className="sortable" onClick={() => setSort('progress')}>Progress{sortMark('progress')}</th>
                  <th style={{ width: 150 }} className="sortable" onClick={() => setSort('due')}>Next due{sortMark('due')}</th>
                  <th style={{ width: 230 }} className="sortable" onClick={() => setSort('email')}>Reminder email{sortMark('email')}</th>
                  <th style={{ width: 130 }} className="sortable" onClick={() => setSort('status')}>Status{sortMark('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { seq, lead, steps: sSteps, next, overdueDays, finished } = r
                  const name = lead ? displayName(lead) : seq.lead_record_id
                  const practice = lead?.practice ?? null
                  const effEmail = r.effEmail
                  const isOverride = (seq.manager_email ?? '').trim() !== ''
                  const isOpen = open.has(seq.id)
                  const dueToday = next ? isDueToday(next) : false

                  return (
                    <Fragment key={seq.id}>
                      <tr className={overdueDays > 0 ? 'fup-row-overdue' : dueToday ? 'fup-row-today' : undefined}>
                        <td>
                          <button className="expander" title={isOpen ? 'Collapse' : 'Show all 5 follow-ups'}
                                  onClick={() => toggleOpen(seq.id)}>
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{name}</div>
                          {practice && <div className="small muted">{practice}</div>}
                          {lead?.email && <div className="small muted">{lead.email}</div>}
                        </td>
                        <td>{lead && <StageChip stage={lead.stage} />}</td>
                        <td>
                          {/* One pill per week: green done, red overdue, amber due today. */}
                          <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                            {sSteps.map((s) => {
                              const done = stepComplete(s)
                              const od = isOverdue(s)
                              const dt = isDueToday(s)
                              const partial = !done && s.channels.some((c) => isChannelDone(s, c))
                              return (
                                <span key={s.id} className="fup-week-pill"
                                      title={`Week ${s.step_number} · ${s.scheduled_date}\n${done ? 'Done' : 'Left: ' + pendingChannels(s).join(', ')}`}
                                      style={{
                                        background: done ? 'var(--green)' : od ? 'var(--warn)' : dt ? '#e8b400' : partial ? 'var(--brand)' : 'var(--line)',
                                        opacity: partial && !od && !dt ? .55 : 1,
                                      }} />
                              )
                            })}
                          </div>
                          <span className="small muted">{r.doneChannels}/{r.totalChannels} channels</span>
                        </td>
                        <td>
                          {finished ? (
                            <span className="small" style={{ fontWeight: 700, color: '#856404' }}>All 5 complete</span>
                          ) : next ? (
                            <>
                              <div className="small" style={{ fontWeight: 600 }}>Week {next.step_number} · {next.scheduled_date}</div>
                              {overdueDays > 0
                                ? <span className="chip" style={{ background: '#fbe2e4', color: '#a01b2c' }}>{overdueDays}d overdue</span>
                                : dueToday
                                  ? <span className="chip" style={{ background: '#fff3cd', color: '#856404' }}>Due today</span>
                                  : <span className="small muted">upcoming</span>}
                            </>
                          ) : <span className="small muted">—</span>}
                        </td>
                        <td>
                          {editingEmail === seq.id ? (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              <input type="email" value={editEmailVal} placeholder={managerEmail || 'manager@example.com'}
                                     onChange={(e) => setEditEmailVal(e.target.value)}
                                     onKeyDown={(e) => { if (e.key === 'Enter') saveEmail(seq.id); if (e.key === 'Escape') setEditingEmail(null) }}
                                     style={{ width: '100%', fontSize: 12 }} autoFocus />
                              <button className="btn" style={{ padding: '3px 10px', fontSize: 11.5 }}
                                      onClick={() => saveEmail(seq.id)} disabled={busySeq === seq.id}>Save</button>
                              <button className="btn ghost" style={{ padding: '3px 9px', fontSize: 11.5 }}
                                      onClick={() => setEditingEmail(null)}>Cancel</button>
                              <span className="small muted" style={{ flexBasis: '100%' }}>Blank = use Admin default</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span className="small" style={{ fontWeight: 600, wordBreak: 'break-all' }}>
                                {effEmail || <span className="muted">not set</span>}
                              </span>
                              {isOverride
                                ? <span className="chip" style={{ background: 'var(--brand-soft)', color: 'var(--brand-dark)' }}>custom</span>
                                : <span className="chip">default</span>}
                              {seq.status === 'active' && (
                                <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 11 }}
                                        onClick={() => { setEditingEmail(seq.id); setEditEmailVal(seq.manager_email ?? '') }}>
                                  Edit
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={'chip fup-status-' + seq.status}>
                            {seq.status === 'active' ? (finished ? '⏳ Awaiting' : '🔄 Active') : seq.status === 'won' ? '✅ Won' : '❌ Lost'}
                          </span>
                          {finished && seq.status === 'active' && (
                            <button className="btn" style={{ padding: '3px 9px', fontSize: 11, marginTop: 5 }}
                                    onClick={() => setResolving(r)} disabled={busySeq === seq.id}>
                              Resolve
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expanded: the 5 weeks, one row each */}
                      {isOpen && sSteps.map((step) => {
                        const complete = stepComplete(step)
                        const od = isOverdue(step)
                        const dt = isDueToday(step)
                        const pending = pendingChannels(step)
                        const editable = !complete && seq.status === 'active'
                        const isNext = next?.id === step.id

                        return (
                          <tr key={step.id} className="fup-steprow">
                            <td></td>
                            <td style={{ fontWeight: 700, fontSize: 12, color: 'var(--brand-dark)' }}>
                              Week {step.step_number}
                              {isNext && !complete && <div className="small muted" style={{ fontWeight: 400 }}>next up</div>}
                            </td>
                            <td colSpan={2}>
                              {editable ? (
                                <input type="date" defaultValue={step.scheduled_date} disabled={busyStep === step.id}
                                       onBlur={(e) => { if (e.target.value && e.target.value !== step.scheduled_date) handleReschedule(step.id, e.target.value) }}
                                       style={{ fontSize: 12.5 }} />
                              ) : (
                                <span className="small" style={{ fontWeight: 600 }}>{step.scheduled_date}</span>
                              )}
                            </td>
                            <td colSpan={2}>
                              {/* Each channel ticks off on its own; the week is finished
                                  only when all of them are, which is what reminders check. */}
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {step.channels.map((ch) => {
                                  const chDone = isChannelDone(step, ch)
                                  return (
                                    <button key={ch} className={'fup-channel-toggle' + (chDone ? ' done' : '')}
                                            disabled={seq.status !== 'active'}
                                            title={seq.status !== 'active' ? ch : chDone ? `${ch} done — click to undo` : `Mark ${ch} as done`}
                                            onClick={() => toggleChannel(step.id, ch)}>
                                      <span>{chDone ? '✓' : CHANNEL_ICON[ch]}</span> {ch}
                                    </button>
                                  )
                                })}
                              </div>
                              {step.notes && <div className="small muted" style={{ marginTop: 4 }}>Note: {step.notes}</div>}
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                {complete && <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green-ink)' }}>✓ Done</span>}
                                {od && <span className="chip" style={{ background: '#fbe2e4', color: '#a01b2c' }}>Overdue</span>}
                                {dt && <span className="chip" style={{ background: '#fff3cd', color: '#856404' }}>Due today</span>}
                                {!complete && pending.length < step.channels.length && (
                                  <span className="small muted">{pending.length} left</span>
                                )}
                                {editable && (
                                  <button className="btn" style={{ padding: '3px 9px', fontSize: 11 }}
                                          disabled={busyStep === step.id}
                                          onClick={() => { setMarkingDone({ stepId: step.id, seqId: seq.id }); setDoneNotes('') }}>
                                    All done
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="small muted" style={{ marginTop: 8 }}>
        Click <b>▸</b> to open a lead's 5 follow-ups. A week is finished only once every one of its channels is ticked —
        reminders keep naming whatever is left.
      </p>

      {/* Mark-all-done modal */}
      {markingDone && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setMarkingDone(null)}>
          <div className="modal" style={{ width: 420 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Mark every channel for this week as done</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
              NOTES (optional)
              <textarea rows={3} placeholder="e.g. Left voicemail, sent follow-up email…" value={doneNotes}
                        onChange={(e) => setDoneNotes(e.target.value)}
                        style={{ font: 'inherit', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, resize: 'vertical' }}
                        autoFocus />
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setMarkingDone(null)} disabled={busyStep === markingDone.stepId}>Cancel</button>
              <button className="btn" onClick={handleMarkDone} disabled={busyStep === markingDone.stepId}>
                {busyStep === markingDone.stepId ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution modal */}
      {resolving && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setResolving(null)}>
          <div className="modal" style={{ width: 460 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Resolve follow-up sequence</h3>
            <p className="small muted" style={{ margin: '0 0 18px' }}>
              Lead: <b>{resolving.lead ? displayName(resolving.lead) : resolving.seq.lead_record_id}</b>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn" style={{ background: 'var(--green-ink)' }} disabled={busySeq === resolving.seq.id}
                      onClick={() => handleResolve('won')}>
                ✅ Got Response — mark sequence as Won
              </button>
              <button className="btn warn" disabled={busySeq === resolving.seq.id} onClick={() => handleResolve('lost')}>
                ❌ No Response — mark lead as Lost
              </button>
              <button className="btn ghost" onClick={() => setResolving(null)} disabled={busySeq === resolving.seq.id}>Cancel</button>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Marking as Lost updates the lead's stage here. Remember to update Zoho CRM too. Left alone, the server marks
              it Lost automatically {automation.graceDays} days after the 5th follow-up.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
