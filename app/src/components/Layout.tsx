import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useAppData } from '../data/AppData'

export default function Layout() {
  const { user, signOut } = useAuth()
  const { leads } = useAppData()
  return (
    <>
      <header className="app">
        <h1>Transcure · SEO Lead Tracker</h1>
        <span className="pill">{leads.length} leads</span>
        <nav className="tabs">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/leads">Leads</NavLink>
          <NavLink to="/funnel">SEO Funnel</NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <span className="who">{user?.email}</span>
          <a onClick={() => signOut()} style={{ cursor: 'pointer' }}>Sign out</a>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
