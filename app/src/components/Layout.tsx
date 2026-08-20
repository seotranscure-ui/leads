import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useAppData } from '../data/AppData'
import { isOverdue, isDueToday } from '../lib/followups'
import Logo from './Logo'

export default function Layout() {
  const { user, signOut } = useAuth()
  const { leads, logoUrl, sequences, steps, projects, project, setProjectId } = useAppData()

  // Workspace switcher. Only rendered when there is more than one project, so a
  // single-project install looks exactly as it did before.
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const dueCount = useMemo(() =>
    steps.filter((s) => {
      const seq = sequences.find((sq) => sq.id === s.sequence_id)
      return seq?.status === 'active' && (isOverdue(s) || isDueToday(s))
    }).length,
    [steps, sequences],
  )

  return (
    <>
      <header className="app">
        <Logo src={logoUrl} />
        {projects.length > 1 ? (
          <div className="ws" ref={pickerRef}>
            <button className="ws-btn" onClick={() => setPickerOpen((o) => !o)} title="Switch workspace">
              <span className="ws-name">{project.name}</span>
              <span className="ws-caret">▾</span>
            </button>
            {pickerOpen && (
              <div className="ws-pop">
                <div className="ws-head">Workspace</div>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className={'ws-opt' + (p.id === project.id ? ' active' : '')}
                    onClick={() => { setProjectId(p.id); setPickerOpen(false) }}
                  >
                    <span>{p.name}</span>
                    {p.id === project.id && <span className="ws-tick">✓</span>}
                  </button>
                ))}
                <div className="ws-note">
                  Leads, funnel stages, reminders and settings are kept separate per workspace.
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="subtitle">SEO Lead Tracker</span>
        )}
        <span className="pill">{leads.length} leads</span>
        <nav className="tabs">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/leads">Leads</NavLink>
          <NavLink to="/funnel">SEO Funnel</NavLink>
          <NavLink to="/follow-ups" style={{ position: 'relative' }}>
            Follow-Ups
            {dueCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: 'var(--warn)', color: '#fff',
                borderRadius: 10, padding: '1px 5px',
                fontSize: 10, fontWeight: 700, lineHeight: 1.4,
              }}>{dueCount}</span>
            )}
          </NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/admin">Admin</NavLink>
          <span className="who">{user?.email}</span>
          <a className="signout" onClick={() => signOut()}>Sign out</a>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
