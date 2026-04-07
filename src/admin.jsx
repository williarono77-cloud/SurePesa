import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import AdminDashboard from './components/AdminDashboard.jsx'
import Toast from './components/Toast.jsx'
import { getToggle } from './utils/storage.js'
import './styles.css'

// Apply saved theme so admin matches main app
const savedTheme = getToggle('theme')
if (savedTheme === 'light') {
  document.documentElement.classList.add('light-mode')
} else {
  document.documentElement.classList.remove('light-mode')
}

function AdminApp() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUser(null)
      setLoading(false)
      return
    }

    let subscription

    try {
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          setUser(session?.user ?? null)
          setLoading(false)
        })
        .catch((error) => {
          console.error('AdminApp: auth.getSession failed', error)
          setUser(null)
          setLoading(false)
          setMessage((prev) => prev ?? { type: 'error', text: 'Failed to load admin session.' })
        })
    } catch (error) {
      console.error('AdminApp: auth.getSession threw', error)
      setUser(null)
      setLoading(false)
      setMessage((prev) => prev ?? { type: 'error', text: 'Failed to load admin session.' })
      return
    }

    try {
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        setUser(session?.user ?? null)
      })
      subscription = data?.subscription
    } catch (error) {
      console.error('AdminApp: onAuthStateChange threw', error)
    }

    return () => {
      try {
        subscription?.unsubscribe()
      } catch (error) {
        console.error('AdminApp: unsubscribe threw', error)
      }
    }
  }, [])

  if (!isSupabaseConfigured) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1.5rem', textAlign: 'center' }}>
        <div>
          <h1 style={{ marginBottom: '0.75rem' }}>Supabase not configured</h1>
          <p style={{ maxWidth: '32rem', margin: '0 auto', opacity: 0.85 }}>
            Supabase is not configured for the admin dashboard. Check <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your <code>.env</code> file and rebuild the app.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div>Loading…</div>
      </div>
    )
  }
  return (
    <div className="app">
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <AdminDashboard user={user} setMessage={setMessage} />
    </div>
  )
}

const adminRoot = document.getElementById('admin-root')
if (adminRoot) {
  ReactDOM.createRoot(adminRoot).render(
    <React.StrictMode>
      <AdminApp />
    </React.StrictMode>,
  )
}
