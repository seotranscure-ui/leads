import { useEffect, useState, type ChangeEvent } from 'react'
import { useAppData } from '../data/AppData'
import { ruleLabel, type HighTicketRule } from '../lib/leads'
import Logo from './Logo'

export default function Admin() {
  const { logoUrl, updateLogo, rule, updateRule } = useAppData()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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
    <div className="card" style={{ maxWidth: 660 }}>
      <h2 className="section" style={{ marginTop: 0 }}>High-ticket criteria</h2>
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
