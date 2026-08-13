import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../data/AppData'
import {
  CHANNEL_ICON, allDone, buildReminderMailto, isOverdue, isDueToday,
  nextPending, type FollowUpSequence, type FollowUpStep,
} from '../lib/followups'
import { displayName, type Lead } from '../lib/leads'
import StartSequenceModal from './StartSequenceModal'

interface SeqRow {
  seq: FollowUpSequence
  lead: Lead | null
  steps: FollowUpStep[]
}

export default function FollowUps() {
  const { leads, sequences, steps, startFollowUp, completeStep, rescheduleStep, resolveSequence, changeSequenceEmail } = useAppData()
  const nav = useNavigate()

  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [startingFor, setStartingFor] = useState<Lead | null>(null)
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

  const seqRows: SeqRow[] = useMemo(() =>
    sequences
      .filter((s) => filter === 'all' || s.status === 'active')
      .map((s) => ({
        seq: s,
        lead: leadMap.get(s.lead_record_id) ?? null,
        steps: (stepsBySeq.get(s.id) ?? []).sort((a, b) => a.step_number - b.step_number),
      })),
    [sequences, filter, leadMap, stepsBySeq],
  )

  const dueCount = useMemo(() =>
    steps.filter((s) => {
      const seq = sequences.find((sq) => sq.id === s.sequence_id)
      return seq?.status === 'active' && (isOverdue(s) || isDueToday(s))
    }).length,
    [steps, sequences],
  )

  // Negotiation leads without an active sequence (suggestion strip)
  const negWithout = useMemo(() => {
    const activeLeads = new Set(sequences.filter((s) => s.status === 'active').map((s) => s.lead_record_id))
    return leads.filter((l) => l.stage === 'Negotiation' && !activeLeads.has(l.record_id)).slice(0, 5)
  }, [leads, sequences])

  const handleMarkDone = async () => {
    if (!markingDone) return
    setBusyStep(markingDone.stepId)
    try {
      await completeStep(markingDone.stepId, doneNotes.trim() || undefined)
    } catch (e) {
      alert('Could not mark step done: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusyStep(null)
      setMarkingDone(null)
      setDoneNotes('')
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

  const saveEmail = async (seqId: string) => {
    if (!editEmailVal.trim()) return
    setBusySeq(seqId)
    try {
      await changeSequenceEmail(seqId, editEmailVal.trim())
      setEditingEmail(null)
    } catch (e) {
      alert('Could not update email: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusySeq(null)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Follow-Ups</h1>
        {dueCount > 0 && (
          <span style={{ background: 'var(--warn)', color: '#fff', borderRadius: 20, padding: '3px 11px', fontSize: 12, fontWeight: 700 }}>
            {dueCount} overdue / due today
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className={'btn' + (filter === 'active' ? '' : ' ghost')} onClick={() => setFilter('active')}>Active</button>
          <button className={'btn' + (filter === 'all' ? '' : ' ghost')} onClick={() => setFilter('all')}>All</button>
        </div>
      </div>

      {/* Suggestion strip: Negotiation leads without a sequence */}
      {negWithout.length > 0 && filter === 'active' && (
        <div className="note" style={{ marginBottom: 16 }}>
          <b>Suggestion:</b> {negWithout.length} lead{negWithout.length > 1 ? 's are' : ' is'} in Negotiation with no active follow-up sequence:{' '}
          {negWithout.map((l, i) => (
            <span key={l.record_id}>
              {i > 0 && ', '}
              <a style={{ cursor: 'pointer' }} onClick={() => setStartingFor(l)}>{displayName(l)}</a>
            </span>
          ))}
          {leads.filter((l) => l.stage === 'Negotiation' && !sequences.find((s) => s.status === 'active' && s.lead_record_id === l.record_id)).length > 5 && ' and more…'}
          {' — '}
          <a style={{ cursor: 'pointer' }} onClick={() => nav('/leads')}>view all in Leads</a>
        </div>
      )}

      {seqRows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">No {filter === 'active' ? 'active ' : ''}follow-up sequences yet.</p>
          {filter === 'active' && (
            <p className="small muted">Start one from the <a onClick={() => nav('/leads')} style={{ cursor: 'pointer' }}>Leads page</a> for any lead in Negotiation stage.</p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {seqRows.map(({ seq, lead, steps: sSteps }) => {
          const name = lead ? displayName(lead) : seq.lead_record_id
          const practice = lead?.practice ?? null
          const isDone = allDone(sSteps)
          const next = nextPending(sSteps)

          return (
            <div key={seq.id} className="card" style={{ padding: 0 }}>
              {/* Card header */}
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{name}</span>
                  {practice && <span className="small muted" style={{ marginLeft: 8 }}>{practice}</span>}
                  {lead && <span className={'chip stage-' + lead.stage} style={{ marginLeft: 8 }}>{lead.stage}</span>}
                </div>
                <span className={'chip fup-status-' + seq.status} style={{ marginLeft: 'auto' }}>
                  {seq.status === 'active' ? (isDone ? '⏳ Awaiting resolution' : '🔄 Active') : seq.status === 'won' ? '✅ Won' : '❌ Lost'}
                </span>
              </div>

              {/* Manager email */}
              <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
                <span className="small muted" style={{ minWidth: 120 }}>Reminder email:</span>
                {editingEmail === seq.id ? (
                  <>
                    <input
                      type="email"
                      value={editEmailVal}
                      onChange={(e) => setEditEmailVal(e.target.value)}
                      style={{ flex: 1, maxWidth: 280 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEmail(seq.id); if (e.key === 'Escape') setEditingEmail(null) }}
                      autoFocus
                    />
                    <button className="btn" style={{ padding: '5px 12px' }} onClick={() => saveEmail(seq.id)} disabled={busySeq === seq.id}>Save</button>
                    <button className="btn ghost" style={{ padding: '5px 10px' }} onClick={() => setEditingEmail(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{seq.manager_email}</span>
                    {seq.status === 'active' && (
                      <button className="btn ghost" style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => { setEditingEmail(seq.id); setEditEmailVal(seq.manager_email) }}>
                        Edit
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Steps */}
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sSteps.map((step) => {
                  const overdue = isOverdue(step)
                  const dueToday = isDueToday(step)
                  const isNext = next?.id === step.id
                  const stepBg = step.status === 'done' ? 'var(--green-soft)' : overdue ? '#fbe8ea' : dueToday ? '#fff9e6' : isNext ? 'var(--brand-soft)' : '#f9f8fc'

                  return (
                    <div key={step.id} style={{ background: stepBg, borderRadius: 10, padding: '10px 14px', border: '1px solid ' + (overdue ? '#f3b6bd' : dueToday ? '#f5d978' : isNext ? 'var(--brand-soft2)' : 'var(--line)') }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 54, fontWeight: 700, fontSize: 12, color: 'var(--brand-dark)' }}>Week {step.step_number}</div>

                        {/* Date: editable when pending */}
                        {step.status === 'pending' && seq.status === 'active' ? (
                          <input
                            type="date"
                            defaultValue={step.scheduled_date}
                            disabled={busyStep === step.id}
                            onBlur={(e) => { if (e.target.value && e.target.value !== step.scheduled_date) handleReschedule(step.id, e.target.value) }}
                            style={{ fontSize: 13 }}
                          />
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{step.scheduled_date}</span>
                        )}

                        {/* Channels */}
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {step.channels.map((ch) => (
                            <span key={ch} className="fup-channel-chip">{CHANNEL_ICON[ch]} {ch}</span>
                          ))}
                        </div>

                        {/* Status badge */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                          {step.status === 'done' && <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green-ink)' }}>✓ Done</span>}
                          {overdue && <span className="chip" style={{ background: '#fbe2e4', color: '#a01b2c' }}>Overdue</span>}
                          {dueToday && <span className="chip" style={{ background: '#fff3cd', color: '#856404' }}>Due today</span>}

                          {/* Actions for active pending steps */}
                          {step.status === 'pending' && seq.status === 'active' && (
                            <>
                              <a
                                href={buildReminderMailto(seq.manager_email, name, practice, step.step_number, step.scheduled_date, step.channels)}
                                className="btn ghost"
                                style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }}
                                title="Open email client with pre-composed reminder"
                              >
                                ✉️ Send Reminder
                              </a>
                              <button
                                className="btn"
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                disabled={busyStep === step.id}
                                onClick={() => { setMarkingDone({ stepId: step.id, seqId: seq.id }); setDoneNotes('') }}
                              >
                                Mark Done
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {step.notes && <div className="small muted" style={{ marginTop: 6, paddingLeft: 64 }}>Note: {step.notes}</div>}
                    </div>
                  )
                })}
              </div>

              {/* Resolution panel — appears after all 5 steps are done */}
              {isDone && seq.status === 'active' && (
                <div style={{ margin: '0 18px 18px', background: '#fff9e6', border: '1px solid #f5d978', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>All 5 follow-ups completed</div>
                  <p className="small" style={{ margin: '0 0 12px', color: 'var(--ink)' }}>
                    Did <b>{name}</b> respond to your outreach?
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn" style={{ background: 'var(--green-ink)' }} disabled={busySeq === seq.id}
                      onClick={() => setResolving({ seq, lead, steps: sSteps })}>
                      ✅ Yes, got response
                    </button>
                    <button className="btn warn" disabled={busySeq === seq.id}
                      onClick={() => setResolving({ seq, lead, steps: sSteps })}>
                      ❌ No response — mark Lost
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Mark Done modal */}
      {markingDone && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setMarkingDone(null)}>
          <div className="modal" style={{ width: 420 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Mark follow-up as done</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
              NOTES (optional)
              <textarea
                rows={3}
                placeholder="e.g. Left voicemail, sent follow-up email…"
                value={doneNotes}
                onChange={(e) => setDoneNotes(e.target.value)}
                style={{ font: 'inherit', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, resize: 'vertical' }}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setMarkingDone(null)} disabled={busyStep === markingDone.stepId}>Cancel</button>
              <button className="btn" onClick={handleMarkDone} disabled={busyStep === markingDone.stepId}>
                {busyStep === markingDone.stepId ? 'Saving…' : 'Confirm Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution confirmation modal */}
      {resolving && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setResolving(null)}>
          <div className="modal" style={{ width: 460 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Resolve follow-up sequence</h3>
            <p className="small muted" style={{ margin: '0 0 18px' }}>
              Lead: <b>{resolving.lead ? displayName(resolving.lead) : resolving.seq.lead_record_id}</b>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn"
                style={{ background: 'var(--green-ink)', justifyContent: 'center' }}
                disabled={busySeq === resolving.seq.id}
                onClick={() => handleResolve('won')}
              >
                ✅ Got Response — mark sequence as Won
              </button>
              <button
                className="btn warn"
                disabled={busySeq === resolving.seq.id}
                onClick={() => handleResolve('lost')}
              >
                ❌ No Response — mark lead as Lost
              </button>
              <button className="btn ghost" onClick={() => setResolving(null)} disabled={busySeq === resolving.seq.id}>
                Cancel
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Marking as Lost will update the lead's stage in this tool. Remember to also update Zoho CRM to keep records in sync.
            </p>
          </div>
        </div>
      )}

      {startingFor && (
        <StartSequenceModal
          lead={startingFor}
          onClose={() => setStartingFor(null)}
          onStart={async (email, stepDefs) => {
            await startFollowUp(startingFor.record_id, email, stepDefs)
            setStartingFor(null)
          }}
        />
      )}
    </>
  )
}
