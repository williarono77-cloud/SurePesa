import { supabase } from '../supabaseClient.js'

export default function Header({ session, view, setView, onClearMessage }) {
  const isGuest = !session

  function handleLogin() {
    onClearMessage?.()
    setView('auth')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    onClearMessage?.()
    setView('landing')
  }

  return (
    <header className="header">
      <div className="header__inner container">
        <h1 className="header__title">Game Platform</h1>
        <div className="header__actions">
          <span className="header__mode" aria-live="polite">
            {isGuest ? 'Guest' : 'Logged in'}
          </span>
          {isGuest ? (
            <button type="button" className="btn btn--primary" onClick={handleLogin}>
              Login
            </button>
          ) : (
            <button type="button" className="btn btn--secondary" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
