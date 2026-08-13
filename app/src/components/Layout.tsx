import { useMemo } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useAppData } from '../data/AppData'
import { isOverdue, isDueToday } from '../lib/followups'
import Logo from './Logo'

export default function Layout() {
  const { user, signOut } = useAuth()
  const { leads, logoUrl, sequences, steps } = useAppData()

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
        <span className="subtitle">SEO Lead Tracker</span>
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
