import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient.js'
import { clearAuthRole } from '../utils/storage.js'

const MIN_PASSWORD_LENGTH = 6

function authErrorMessage(err) {
  const msg = err?.message || ''
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) return 'Invalid email or password.'
  if (msg.includes('Email not confirmed')) return 'Please confirm your email. Check your inbox for the confirmation link.'
  if (msg.includes('User already registered')) return 'An account with this email already exists. Try logging in.'
  if (msg.includes('Password')) return msg
  return msg || 'Something went wrong. Please try again.'
}

export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [registerEmailSent, setRegisterEmailSent] = useState(false)
  const firstInputRef = useRef(null)

  // Reset form when modal closes; focus first input when opens
  useEffect(() => {
    if (!isOpen) {
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setError(null)
      setRegisterEmailSent(false)
      setMode('login')
    } else {
      setError(null)
      setRegisterEmailSent(false)
      const t = setTimeout(() => firstInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }
    if (mode === 'register') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
    }
    setLoading(true)
    try {
      if (mode === 'register') {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth/callback`,
        },
      })
        if (err) throw err
        setError(null)
        // If Supabase requires email confirmation, session may be null until user confirms
        if (data?.session) {
          onSuccess?.()
          onClose()
          return
        }
        setRegisterEmailSent(true)
        return
      }
    const { data: signInData, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (err) throw err
    setError(null)
    
    // Always clear cached role on fresh login
    clearAuthRole()
    
    let resolvedRole = 'user'
    
    if (signInData?.user?.id) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', signInData.user.id)
        .maybeSingle()
    
      if (profileError) {
        console.error('Profile role fetch failed after login', profileError)
      } else if (profile?.role === 'admin') {
        resolvedRole = 'admin'
      }
    }
    
    onClose()
    
    if (resolvedRole === 'admin') {
      window.location.replace('/admin.html')
      return
    }
    
    onSuccess?.()
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const showForm = !registerEmailSent

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="auth-title" className="modal__title">
          {registerEmailSent ? 'Check your email' : mode === 'login' ? 'Login' : 'Register'}
        </h2>

        {registerEmailSent ? (
          <div className="modal__form">
            <p className="modal__hint" style={{ marginBottom: '1rem' }}>
              We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your account, then log in.
            </p>
            <button type="button" className="modal__button" onClick={() => { setRegisterEmailSent(false); setMode('login'); }}>
              Back to Login
            </button>
          </div>
        ) : (
          <form className="modal__form" onSubmit={handleSubmit}>
            {error && <p className="text-error" role="alert">{error}</p>}
            <div className="modal__label">
              <span className="modal__label-text">Email</span>
              <input
                ref={firstInputRef}
                type="email"
                className="modal__input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
              />
            </div>
            <div className="modal__label">
              <span className="modal__label-text">Password</span>
              <input
                type="password"
                className="modal__input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
                disabled={loading}
              />
            </div>
            {mode === 'register' && (
              <>
                <div className="modal__label">
                  <span className="modal__label-text">Confirm password</span>
                  <input
                    type="password"
                    className="modal__input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={loading}
                  />
                </div>
                <p className="modal__hint">Password must be at least {MIN_PASSWORD_LENGTH} characters.</p>
              </>
            )}
            <button type="submit" className="modal__button" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>
        )}

        {showForm && (
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--accent-green)', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); setConfirmPassword(''); }}
            >
              {mode === 'login' ? 'Register' : 'Login'}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}


