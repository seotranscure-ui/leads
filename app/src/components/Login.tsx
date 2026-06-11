import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabaseConfigured } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await signIn(email.trim(), password)
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Transcure · Lead Tracker</h1>
        <div className="muted small">Sign in to continue</div>
        {!supabaseConfigured && (
          <div className="note err" style={{ marginTop: 12 }}>
            Supabase isn’t configured yet — set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.
          </div>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {err && <div className="note err" style={{ marginTop: 12 }}>{err}</div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="muted small" style={{ marginTop: 14 }}>
          Accounts are created by your admin in Supabase. No public sign-up.
        </div>
      </form>
    </div>
  )
}
