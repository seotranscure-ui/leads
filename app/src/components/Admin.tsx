import { useEffect, useState, type ChangeEvent } from 'react'
import { useAppData } from '../data/AppData'
import { ruleLabel, type HighTicketRule } from '../lib/leads'
import {
  fetchReminderLog, sendTestReminder, previewReminders, runRemindersNow, pingReminders,
  type ReminderLog, type ReminderRunResult,
} from '../lib/api'
import Logo from './Logo'
import FunnelEditor from './FunnelEditor'

export default function Admin() {
  const {
    logoUrl, updateLogo, rule, updateRule, managerEmail, updateManagerEmail,
    sequences, automation, updateAutomation, project, funnel, updateProject,
  } = useAppData()

  // Per-project basics: charge rate and which stage enrols a lead in follow-ups.
  const [charge, setCharge] = useState(String(project.default_charge_pct))
  const [fupStage, setFupStage] = useState(project.follow_up_stage ?? '')
  const [projMsg, setProjMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => {
    setCharge(String(project.default_charge_pct))
    setFupStage(project.follow_up_stage ?? '')
    setProjMsg(null)
  }, [project.id, project.default_charge_pct, project.follow_up_stage])

  const saveProjectBasics = async () => {
    const n = Number(charge)
    if (charge.trim() === '' || isNaN(n) || n < 0 || n > 100) {
      setProjMsg({ kind: 'err', text: 'Charge % must be a number between 0 and 100.' }); return
    }
    setProjMsg(null)
    try {
      await updateProject({ default_charge_pct: n, follow_up_stage: fupStage || null })
      setProjMsg({ kind: 'ok', text: 'Workspace settings saved.' })
    } catch (e) {
      setProjMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Lead-manager email — the default recipient for every follow-up reminder.
  const [email, setEmail] = useState(managerEmail)
  const [emailMsg, setEmailMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => { setEmail(managerEmail) }, [managerEmail])

  const overrideCount = sequences.filter((s) => (s.manager_email ?? '').trim() !== '').length

  // Automatic-reminder settings + the send log (the proof the cron job is alive).
  const [auto, setAuto] = useState(automation)
  const [autoMsg, setAutoMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [log, setLog] = useState<ReminderLog[] | null>(null)
  useEffect(() => { setAuto(automation) }, [automation])
  useEffect(() => { fetchReminderLog(20).then(setLog).catch(() => setLog([])) }, [])

  const saveAuto = async () => {
    if (auto.graceDays < 1 || auto.graceDays > 90) {
      setAutoMsg({ kind: 'err', text: 'Grace period must be between 1 and 90 days.' }); return
    }
    setAutoMsg(null)
    try {
      await updateAutomation(auto)
      setAutoMsg({ kind: 'ok', text: 'Reminder settings saved.' })
    } catch (e) {
      setAutoMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Test / preview / run-now against the reminder Edge Function ─────────────
  const [testTo, setTestTo] = useState('')
  const [running, setRunning] = useState<'test' | 'dry' | 'now' | 'ping' | null>(null)
  const [runMsg, setRunMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => { if (!testTo && managerEmail) setTestTo(managerEmail) }, [managerEmail])

  // Turn the function's reply into something a non-developer can act on.
  const describe = (r: ReminderRunResult): { kind: 'ok' | 'err'; text: string } => {
    // Diagnostic result — report config presence and whether the mail library loads.
    if (r.ok && r.boot) {
      const s = r.secretsPresent ?? {}
      const flag = (k: string) => (s[k] === true ? '✓ set' : s[k] === false ? '✗ MISSING' : String(s[k]))
      const libOk = (r.smtpLib ?? '').startsWith('loaded')
      const tcp = r.tcp ?? {}
      const tcpLines = Object.entries(tcp).map(([k, v]) => `  ${k} → ${v}`)
      const anyReachable = Object.values(tcp).some((v) => v.startsWith('reachable'))
      const probed = Object.keys(tcp).length > 0

      let verdict: string
      if (!libOk) {
        verdict = 'The mail library could not load inside the function. That is a dependency problem, not a credentials problem.'
      } else if (probed && !anyReachable) {
        verdict = 'The function cannot open a connection to your mail server on either port. Nothing about the credentials matters until this is fixed — the traffic is not getting through. Most likely the SMTP port is blocked outbound from Supabase, or the server only accepts connections from inside your network.'
      } else if (probed && anyReachable) {
        verdict = 'The mail server is reachable, so any send failure from here is the credentials or the server rejecting the message.'
      } else {
        verdict = 'Deployment and config are fine.'
      }

      return {
        kind: libOk && (!probed || anyReachable) ? 'ok' : 'err',
        text: [
          `Function is deployed and reachable. Authenticated as: ${r.authedAs}.`,
          '',
          `SMTP library: ${r.smtpLib}`,
          ...(tcpLines.length ? ['', 'Connection to the mail server:', ...tcpLines] : []),
          '',
          `SMTP_HOST: ${flag('SMTP_HOST')}`,
          `SMTP_PORT: ${s.SMTP_PORT}`,
          `SMTP_USER: ${flag('SMTP_USER')}`,
          `SMTP_PASS: ${flag('SMTP_PASS')}`,
          `SMTP_FROM: ${flag('SMTP_FROM')}`,
          `APP_URL:   ${s.APP_URL}`,
          '',
          verdict,
        ].join('\n'),
      }
    }
    if (!r.ok) {
      if (r.missingSecrets?.length) {
        return { kind: 'err', text: `Not configured yet — these secrets are missing in Supabase: ${r.missingSecrets.join(', ')}. Add them under Project Settings → Edge Functions → Secrets, then redeploy the function.` }
      }
      const e = r.error ?? 'unknown error'
      if (/auth|credential|password|535|534/i.test(e)) {
        return { kind: 'err', text: `The mail server rejected the login. Check SMTP_USER and SMTP_PASS.\n\n${e}` }
      }
      if (/timeout|refused|dns|getaddrinfo|connect/i.test(e)) {
        return { kind: 'err', text: `Could not reach the mail server. Check SMTP_HOST and SMTP_PORT (try 465 if 587 fails), and that it accepts connections from the internet.\n\n${e}` }
      }
      if (/unauthorized/i.test(e)) {
        return { kind: 'err', text: `The function refused the call. Try signing out and back in.\n\n${e}` }
      }
      return { kind: 'err', text: e }
    }
    if (r.tested) return { kind: 'ok', text: `Test email sent to ${r.tested}. Check the inbox — and the spam folder if it is not there.` }
    if (r.skipped) return { kind: 'ok', text: 'Automation is switched off, so nothing was sent. Tick "Send reminders automatically" above first.' }
    if (r.note) return { kind: 'ok', text: 'Nothing to send — no active follow-up sequences.' }
    const parts: string[] = []
    const n = r.digestsSent?.length ?? 0
    parts.push(r.dryRun
      ? (n ? `Would send ${n} digest email${n > 1 ? 's' : ''}: ${r.digestsSent!.join(', ')}` : 'Nothing is due — no digest would be sent')
      : (n ? `Sent ${n} digest email${n > 1 ? 's' : ''} to: ${r.digestsSent!.join(', ')}` : 'Nothing was due, so no digest was sent'))
    const dup = r.alreadySentToday?.length ?? 0
    if (dup) parts.push(`${dup} recipient${dup > 1 ? 's' : ''} already had today's digest, so it was not sent again`)
    if (r.prompted) parts.push(`${r.prompted} decision prompt${r.prompted > 1 ? 's' : ''}`)
    if (r.autoLost) parts.push(`${r.autoLost} lead${r.autoLost > 1 ? 's' : ''} auto-marked Lost`)
    if (r.failed?.length) return { kind: 'err', text: parts.join(' · ') + `\n\nFailures: ` + r.failed.map((f) => `${f.to}: ${f.error}`).join('; ') }
    return { kind: 'ok', text: parts.join(' · ') }
  }

  const doRun = async (kind: 'test' | 'dry' | 'now' | 'ping') => {
    if (kind === 'test' && !testTo.trim()) {
      setRunMsg({ kind: 'err', text: 'Enter an address to send the test to.' }); return
    }
    setRunning(kind); setRunMsg(null)
    try {
      const r = kind === 'test' ? await sendTestReminder(testTo.trim())
              : kind === 'dry' ? await previewReminders()
              : kind === 'ping' ? await pingReminders()
              : await runRemindersNow()
      setRunMsg(describe(r))
      if (kind === 'now' || kind === 'test') fetchReminderLog(20).then(setLog).catch(() => {})
    } catch (e) {
      // A fetch-level failure never reaches the function at all.
      const msg = e instanceof Error ? e.message : String(e)
      setRunMsg({
        kind: 'err',
        text: /failed to send a request|fetch/i.test(msg)
          ? `The request never reached the Edge Function.\n\nThis usually means the function crashed on start-up (so the platform replied without CORS headers), or it is not deployed. Check the function's Logs tab in Supabase for a boot or import error.\n\n${msg}`
          : msg,
      })
    } finally {
      setRunning(null)
    }
  }

  const saveEmail = async () => {
    const v = email.trim()
    if (v !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setEmailMsg({ kind: 'err', text: 'Enter a valid email address.' }); return
    }
    setEmailMsg(null)
    try {
      await updateManagerEmail(v)
      setEmailMsg({ kind: 'ok', text: v ? 'Lead-manager email saved.' : 'Lead-manager email cleared.' })
    } catch (e) {
      setEmailMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  // High-ticket rule editor
  const [op, setOp] = useState<HighTicketRule['op']>(rule.op)
  const [v1, setV1] = useState(String(rule.value))
  const [v2, setV2] = useState(String(rule.value2 ?? ''))
  const [ruleMsg, setRuleMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => { setOp(rule.op); setV1(String(rule.value)); setV2(String(rule.value2 ?? '')) }, [rule])

  const applyRule = async () => {
    if (v1.trim() === '' || isNaN(Number(v1))) { setRuleMsg({ kind: 'err', text: 'Enter a valid amount for the threshold.' }); return }
    if (op === 'between' && (v2.trim() === '' || isNaN(Number(v2)))) { setRuleMsg({ kind: 'err', text: 'Enter both amounts for a "between" rule.' }); return }
    setRuleMsg(null)
    try {
      await updateRule({ op, value: Number(v1), value2: op === 'between' ? Number(v2) : undefined })
      setRuleMsg({ kind: 'ok', text: 'High-ticket rule saved.' })
    } catch (e) {
      setRuleMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f) return
    if (!f.type.startsWith('image/')) { setMsg({ kind: 'err', text: 'Please choose an image file (PNG, JPG, SVG…).' }); return }
    if (f.size > 1024 * 1024) { setMsg({ kind: 'err', text: 'Image is larger than 1 MB — please upload a smaller/optimized logo.' }); return }
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy(true); setMsg(null)
      try {
        await updateLogo(String(reader.result))
        setMsg({ kind: 'ok', text: 'Logo updated — it now shows in the header for everyone.' })
      } catch (err) {
        setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(false)
      }
    }
    reader.readAsDataURL(f)
  }

  const remove = async () => {
    setBusy(true); setMsg(null)
    try {
      await updateLogo(null)
      setMsg({ kind: 'ok', text: 'Logo reset to the default.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="note" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span>Every setting on this page applies to the <b>{project.name}</b> workspace only. Switch workspace in the header to configure the other.</span>
    </div>

    <h2 className="section" style={{ marginTop: 0 }}>Workspace — {project.name}</h2>
    <div className="card" style={{ maxWidth: 660 }}>
      <div className="controls" style={{ marginBottom: 8 }}>
        <label className="small muted">Default charge %</label>
        <input type="number" step="0.1" min="0" max="100" value={charge}
               onChange={(e) => setCharge(e.target.value)} style={{ width: 100 }} />
        <span className="small muted">of monthly collections, unless a lead overrides it</span>
      </div>
      <div className="controls" style={{ marginBottom: 8 }}>
        <label className="small muted">Follow-ups start at stage</label>
        <select value={fupStage} onChange={(e) => setFupStage(e.target.value)}>
          <option value="">— no follow-ups for this workspace —</option>
          {funnel.stages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <button className="btn" onClick={saveProjectBasics} style={{ marginLeft: 'auto' }}>Save workspace</button>
      </div>
      <div className="small muted">
        Leads reaching <b>{project.follow_up_stage || 'nothing'}</b> are enrolled in the 5-week sequence automatically.
      </div>
      {projMsg && <div className={'note ' + (projMsg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 12 }}>{projMsg.text}</div>}
    </div>

    <h2 className="section">Funnel stages — {project.name}</h2>
    <FunnelEditor />

    <h2 className="section">High-ticket criteria</h2>
    <div className="card" style={{ maxWidth: 660 }}>
      <p className="small muted">
        A lead is marked <b>high-ticket ⭐</b> when its <b>Monthly Collections</b> meet this rule (or you set the manual ⭐ on a lead).
        This does <b>not</b> mean "any lead with revenue" — set a real threshold below.
      </p>
      <div className="controls" style={{ marginBottom: 8 }}>
        <label className="small muted">Monthly Collections</label>
        <select value={op} onChange={(e) => setOp(e.target.value as HighTicketRule['op'])}>
          <option value="gte">≥ (at least)</option>
          <option value="gt">&gt; (more than)</option>
          <option value="lte">≤ (at most)</option>
          <option value="lt">&lt; (less than)</option>
          <option value="between">between</option>
        </select>
        <input type="number" value={v1} onChange={(e) => setV1(e.target.value)} style={{ width: 140 }} placeholder="$ e.g. 50000" />
        {op === 'between' && (<><span className="small muted">and</span><input type="number" value={v2} onChange={(e) => setV2(e.target.value)} style={{ width: 140 }} placeholder="$" /></>)}
        <button className="btn" onClick={applyRule}>Save rule</button>
      </div>
      <div className="small muted">Current: <b>{ruleLabel(rule)}</b></div>
      {ruleMsg && <div className={'note ' + (ruleMsg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 12 }}>{ruleMsg.text}</div>}
    </div>

    <h2 className="section">Follow-ups — Lead manager email</h2>
    <div className="card" style={{ maxWidth: 660 }}>
      <p className="small muted">
        Follow-up reminders are addressed to this person by default. Every lead that reaches <b>Negotiation</b> stage is
        enrolled in a 5-week sequence automatically. You can override the address for an individual lead on the
        Follow-Ups page — leads without an override always follow whatever is set here.
      </p>
      <div className="controls" style={{ marginBottom: 8 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveEmail() }}
          placeholder="manager@example.com"
          style={{ width: 280 }}
        />
        <button className="btn" onClick={saveEmail}>Save email</button>
      </div>
      <div className="small muted">
        Current: <b>{managerEmail.trim() || 'not set'}</b>
        {overrideCount > 0 && <> · {overrideCount} lead{overrideCount > 1 ? 's' : ''} with a custom address (unaffected by this setting)</>}
      </div>
      {emailMsg && <div className={'note ' + (emailMsg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 12 }}>{emailMsg.text}</div>}
    </div>

    <h2 className="section">Follow-ups — Automatic reminders</h2>
    <div className="card" style={{ maxWidth: 660 }}>
      <p className="small muted">
        The server emails a digest of everything outstanding once a day, over Transcure's own SMTP server. A week keeps
        appearing in that digest until <b>every</b> one of its channels is ticked off, and repeats daily while overdue.
        Nobody needs to have the tool open.
      </p>

      <div className="controls" style={{ marginBottom: 10 }}>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
          <input type="checkbox" checked={auto.enabled}
                 onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })} />
          Send reminders automatically
        </label>
      </div>

      <div className="controls" style={{ marginBottom: 10 }}>
        <label className="small muted">Send at</label>
        <select value={auto.digestHour} onChange={(e) => setAuto({ ...auto, digestHour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
        <span className="small muted">Pakistan time</span>

        <label className="small muted" style={{ marginLeft: 12 }}>Mark Lost after</label>
        <input type="number" min="1" max="90" value={auto.graceDays} style={{ width: 74 }}
               onChange={(e) => setAuto({ ...auto, graceDays: Number(e.target.value) })} />
        <span className="small muted">days with no outcome recorded</span>
      </div>

      <div className="controls" style={{ marginBottom: 10 }}>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
          <input type="checkbox" checked={auto.remindOverdueDaily}
                 onChange={(e) => setAuto({ ...auto, remindOverdueDaily: e.target.checked })} />
          Keep reminding daily while overdue
        </label>
        <button className="btn" onClick={saveAuto} style={{ marginLeft: 'auto' }}>Save settings</button>
      </div>

      <div className="note" style={{ marginTop: 4 }}>
        <b>Changing the send time also needs a cron update.</b> The hour above is what the app displays and what the job
        assumes; the actual trigger lives in Supabase. After changing it, re-run
        <code> app/supabase/migrations/004_cron_schedule.sql</code> with the new hour converted to UTC (Pakistan is UTC+5,
        so subtract 5).
      </div>

      {autoMsg && <div className={'note ' + (autoMsg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 12 }}>{autoMsg.text}</div>}

      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '22px 0 8px' }}>Test the mailing system</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        These run the real job on the server, using the real SMTP settings — the same path the daily schedule uses.
        Start with <b>Send test email</b>.
      </p>

      <div className="controls" style={{ marginBottom: 8 }}>
        <button className="btn ghost" onClick={() => doRun('ping')} disabled={running !== null}
                title="Check the function is deployed and can see its settings — sends nothing, opens no connection">
          {running === 'ping' ? 'Checking…' : '① Diagnose'}
        </button>
        <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
               placeholder="where to send the test" style={{ width: 250 }} />
        <button className="btn" onClick={() => doRun('test')} disabled={running !== null}>
          {running === 'test' ? 'Sending…' : '② Send test email'}
        </button>
        <button className="btn ghost" onClick={() => doRun('dry')} disabled={running !== null}
                title="Report what a real run would send, without sending anything">
          {running === 'dry' ? 'Checking…' : 'Preview (sends nothing)'}
        </button>
        <button className="btn ghost" onClick={() => doRun('now')} disabled={running !== null}
                title="Send today's digest now instead of waiting for the schedule">
          {running === 'now' ? 'Running…' : 'Run digest now'}
        </button>
      </div>

      {runMsg && (
        <div className={'note ' + (runMsg.kind === 'ok' ? 'ok' : 'err')} style={{ whiteSpace: 'pre-wrap' }}>
          {runMsg.text}
        </div>
      )}

      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 8px' }}>Recent sends</h3>
      {log === null ? (
        <div className="small muted">Loading…</div>
      ) : log.length === 0 ? (
        <div className="small muted">
          Nothing sent yet. Once the cron job is scheduled, every send is recorded here — the quickest way to confirm
          the job is actually running.
        </div>
      ) : (
        <div className="tablewrap" style={{ maxHeight: 260 }}>
          <table>
            <thead><tr><th>When</th><th>To</th><th>Kind</th><th className="right">Items</th><th>Status</th></tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{r.recipient}</td>
                  <td className="small">{r.kind}</td>
                  <td className="right small">{r.step_count}</td>
                  <td className="small">
                    {r.status === 'sent'
                      ? <span style={{ color: 'var(--green-ink)', fontWeight: 700 }}>sent</span>
                      : <span style={{ color: 'var(--warn)', fontWeight: 700 }} title={r.error ?? ''}>failed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <h2 className="section">Branding — Logo</h2>
    <div className="card" style={{ maxWidth: 660 }}>
      <p className="small muted">
        Upload your Transcure logo (a <b>transparent-background PNG</b> works best; under 1 MB). It's stored in your
        database and shown in the header for everyone — no redeploy needed. Change or remove it here anytime.
      </p>
      <div className="logo-preview">
        {logoUrl ? <img src={logoUrl} alt="Logo preview" style={{ maxHeight: 56, maxWidth: '100%' }} /> : <Logo size={44} />}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} disabled={busy} />
        </label>
        {logoUrl && <button className="btn ghost" onClick={remove} disabled={busy}>Remove (use default)</button>}
      </div>
      {msg && <div className={'note ' + (msg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 14 }}>{msg.text}</div>}
    </div>
    </>
  )
}
