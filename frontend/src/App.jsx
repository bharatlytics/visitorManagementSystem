import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Visitors from './pages/Visitors'
import Visits from './pages/Visits'
import Approvals from './pages/Approvals'
import Watchlist from './pages/Watchlist'
import Analytics from './pages/Analytics'
import Reports from './pages/Reports'
import Devices from './pages/Devices'
import Settings from './pages/Settings'
import Login from './pages/Login'
import { useAuthStore } from './store/authStore'

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth().finally(() => setLoading(false))
  }, [checkAuth])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-blue-600"></div>
      </div>
    )
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />
        <Route
          path="/*"
          element={
            isAuthenticated ? (
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/visitors" element={<Visitors />} />
                  <Route path="/visits" element={<Visits />} />
                  <Route path="/approvals" element={<Approvals />} />
                  <Route path="/watchlist" element={<Watchlist />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  )
}

export default App
