import { Routes, Route } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppDataProvider } from './data/AppData'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import LeadsPage from './components/LeadsPage'
import Funnel from './components/Funnel'
import Upload from './components/Upload'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <div className="center-msg">Loading…</div>
  if (!session) return <Login />

  return (
    <AppDataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="funnel" element={<Funnel />} />
          <Route path="upload" element={<Upload />} />
        </Route>
      </Routes>
    </AppDataProvider>
  )
}
