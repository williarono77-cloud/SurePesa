import PublicGamePanel from './PublicGamePanel.jsx'

export default function GuestView({ setView }) {
  function requireAuth() {
    setView('auth')
  }

  return (
    <main className="guest-view container">
      <div className="guest-banner" role="status">
        Viewing as guest. Create an account to deposit and play.
      </div>
      <PublicGamePanel />
      <div className="guest-view__actions">
        <button type="button" className="btn btn--primary" onClick={requireAuth}>
          Deposit
        </button>
        <button type="button" className="btn btn--secondary" onClick={requireAuth}>
          Withdraw
        </button>
      </div>
      <p className="guest-view__hint">Deposit and Withdraw require an account. Click either button to sign in or register.</p>
    </main>
  )
}
