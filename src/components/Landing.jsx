export default function Landing({ setView }) {
  return (
    <main className="landing container">
      <section className="landing__hero">
        <h2>Welcome</h2>
        <p>View current rounds, winners, and history. Sign in to deposit and withdraw.</p>
      </section>
      <div className="landing__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={() => setView('guest')}>
          Continue as Guest
        </button>
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setView('auth')}>
          Login / Register
        </button>
      </div>
    </main>
  )
}
