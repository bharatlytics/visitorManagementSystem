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
import SSOCallback from './pages/SSOCallback'
import VisitApproval from './pages/VisitApproval'
import { useAuthStore } from './store/authStore'

import VisitorRegistration from './pages/VisitorRegistration'
import VisitorPortal from './pages/VisitorPortal'
import Evacuation from './pages/Evacuation'

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Skip auth check if on public routes (SSO callback, approval, visitor registration, visitor portal, kiosk)
    const isPublicPath = ['/sso-callback', '/kiosk'].some(p => window.location.pathname.startsWith(p)) ||
      window.location.pathname.startsWith('/approval/') ||
      window.location.pathname.startsWith('/visitor-registration/') ||
      window.location.pathname.startsWith('/visitor-portal/')

    if (isPublicPath) {
      setLoading(false)
      return
    }
    checkAuth().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

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
        {/* Public routes - no authentication required */}
        <Route path="/sso-callback" element={<SSOCallback />} />
        <Route path="/approval/:token" element={<VisitApproval />} />
        <Route path="/visitor-registration/:token" element={<VisitorRegistration />} />
        <Route path="/visitor-portal/:token" element={<VisitorPortal />} />
        <Route path="/kiosk" element={<VisitorRegistration />} />
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
                  <Route path="/evacuation" element={<Evacuation />} />
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
