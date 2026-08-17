import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../data/AppData'
import {
  CHANNEL_ICON, allDone, effectiveEmail, isOverdue, isDueToday,
  isChannelDone, pendingChannels, stepComplete, nextPending, todayIso,
  type FollowUpSequence, type FollowUpStep,
} from '../lib/followups'
import { displayName, type Lead } from '../lib/leads'

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
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

export default function FollowUps() {
  const {
    leads, sequences, steps, followUpError, managerEmail, automation,
    toggleChannel, completeStep, rescheduleStep, resolveSequence, changeSequenceEmail,
  } = useAppData()
  const nav = useNavigate()

  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [q, setQ] = useState('')
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

  // One row per lead, ordered as a work queue: most overdue first, then by what
  // falls due soonest, then finished sequences awaiting a decision.
  const rows: SeqRow[] = useMemo(() => {
    const today = todayIso()
    const term = q.trim().toLowerCase()

    const built = sequences
      .filter((s) => filter === 'all' || s.status === 'active')
      .map((seq) => {
        const lead = leadMap.get(seq.lead_record_id) ?? null
        const sSteps = (stepsBySeq.get(seq.id) ?? []).sort((a, b) => a.step_number - b.step_number)
        const totalChannels = sSteps.reduce((n, s) => n + s.channels.length, 0)
        const doneChannels = sSteps.reduce((n, s) => n + s.channels.filter((c) => isChannelDone(s, c)).length, 0)
        const next = nextPending(sSteps)
        const overdueDays = next && next.scheduled_date < today ? daysBetween(next.scheduled_date, today) : 0
        return { seq, lead, steps: sSteps, doneChannels, totalChannels, next, overdueDays, finished: allDone(sSteps) }
      })
      .filter((r) => {
        if (!term) return true
        const l = r.lead
        return [l ? displayName(l) : r.seq.lead_record_id, l?.practice, l?.email, l?.specialty]
          .some((v) => (v ?? '').toLowerCase().includes(term))
      })

    return built.sort((a, b) => {
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      const ad = a.next?.scheduled_date ?? '9999-12-31'
      const bd = b.next?.scheduled_date ?? '9999-12-31'
      return ad.localeCompare(bd)
    })
  }, [sequences, filter, q, leadMap, stepsBySeq])

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
        <span className="small muted">{rows.length} lead{rows.length === 1 ? '' : 's'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search name, practice, email…" value={q}
                 onChange={(e) => setQ(e.target.value)} style={{ width: 220, fontSize: 12.5 }} />
          <button className={'btn' + (filter === 'active' ? '' : ' ghost')} onClick={() => setFilter('active')}>Active</button>
          <button className={'btn' + (filter === 'all' ? '' : ' ghost')} onClick={() => setFilter('all')}>All</button>
        </div>
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
            {q.trim() ? 'No leads match that search.' : `No ${filter === 'active' ? 'active ' : ''}follow-up sequences.`}
          </p>
          {!q.trim() && <p className="small muted">Sequences are created automatically for every lead that reaches <b>Negotiation</b> stage.</p>}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap" style={{ maxHeight: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Lead</th>
                  <th style={{ width: 96 }}>Stage</th>
                  <th style={{ width: 150 }}>Progress</th>
                  <th style={{ width: 150 }}>Next due</th>
                  <th style={{ width: 230 }}>Reminder email</th>
                  <th style={{ width: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { seq, lead, steps: sSteps, next, overdueDays, finished } = r
                  const name = lead ? displayName(lead) : seq.lead_record_id
                  const practice = lead?.practice ?? null
                  const effEmail = effectiveEmail(seq, managerEmail)
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
                        <td>{lead && <span className={'chip stage-' + lead.stage}>{lead.stage}</span>}</td>
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
