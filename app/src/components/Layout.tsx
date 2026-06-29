import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useAppData } from '../data/AppData'
import Logo from './Logo'

export default function Layout() {
  const { user, signOut } = useAuth()
  const { leads, logoUrl } = useAppData()
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
