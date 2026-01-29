import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import api from './api/client'
import { useAuthStore } from './store/authStore'

// Register the logout handler for 401 errors
api.onUnauthorized = () => {
  useAuthStore.getState().logout()
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
