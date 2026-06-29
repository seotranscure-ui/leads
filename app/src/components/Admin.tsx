import { useState, type ChangeEvent } from 'react'
import { useAppData } from '../data/AppData'
import Logo from './Logo'

export default function Admin() {
  const { logoUrl, updateLogo } = useAppData()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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
    <div className="card" style={{ maxWidth: 660 }}>
      <h2 className="section" style={{ marginTop: 0 }}>Branding — Logo</h2>
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
  )
}
