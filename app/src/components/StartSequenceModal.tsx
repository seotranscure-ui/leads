import { useState } from 'react'
import { STEP_CHANNELS, CHANNEL_ICON, defaultDates, todayIso } from '../lib/followups'
import type { Lead } from '../lib/leads'
import { displayName } from '../lib/leads'

interface Props {
  lead: Lead
  onClose: () => void
  onStart: (email: string, steps: { scheduled_date: string; channels: string[] }[]) => Promise<void>
}

export default function StartSequenceModal({ lead, onClose, onStart }: Props) {
  const today = todayIso()
  const [email, setEmail] = useState('')
  const [dates, setDates] = useState<string[]>(() => defaultDates(today))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const setDate = (i: number, val: string) => {
    setDates((prev) => prev.map((d, idx) => idx === i ? val : d))
  }

  const handleStart = async () => {
    if (!email.trim()) { setErr('Manager email is required.'); return }
    if (dates.some((d) => !d)) { setErr('All 5 follow-up dates are required.'); return }
    setSaving(true)
    setErr('')
    try {
      const stepDefs = STEP_CHANNELS.map((channels, i) => ({
        scheduled_date: dates[i],
        channels: [...channels],
      }))
      await onStart(email.trim(), stepDefs)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 620 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>Start Follow-Up Sequence</h2>
        <p className="small muted" style={{ margin: '0 0 20px' }}>
          Lead: <b>{displayName(lead)}</b>{lead.practice ? ` · ${lead.practice}` : ''}
        </p>

        <div className="form-grid">
          <label className="wide">
            Manager email — send reminders to
            <input
              type="email"
              placeholder="manager@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
        </div>

        <div style={{ marginTop: 20, marginBottom: 8, fontWeight: 700, fontSize: 13 }}>Follow-up dates</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {STEP_CHANNELS.map((channels, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--brand-soft)', borderRadius: 9, padding: '8px 12px' }}>
              <div style={{ width: 54, fontWeight: 700, fontSize: 12, color: 'var(--brand-dark)' }}>Week {i + 1}</div>
              <input
                type="date"
                value={dates[i]}
                min={today}
                onChange={(e) => setDate(i, e.target.value)}
                style={{ flex: '0 0 auto' }}
              />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {channels.map((ch) => (
                  <span key={ch} className="fup-channel-chip">
                    {CHANNEL_ICON[ch]} {ch}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {err && <div className="note err" style={{ marginTop: 12 }}>{err}</div>}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn" onClick={handleStart} disabled={saving}>
            {saving ? 'Starting…' : 'Start Sequence'}
          </button>
        </div>
      </div>
    </div>
  )
}
