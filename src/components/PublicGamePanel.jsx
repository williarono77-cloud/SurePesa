import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient.js'

export default function PublicGamePanel() {
  const [currentRound, setCurrentRound] = useState(null)
  const [winners, setWinners] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function fetchPublic() {
    setLoading(true)
    setError(null)
    try {
      const [roundRes, previousRes] = await Promise.allSettled([
        supabase.from('current_round').select('*').maybeSingle(),
        supabase.from('previous_round').select('*').maybeSingle(),
      ])
      if (roundRes.status === 'fulfilled' && roundRes.value?.data != null) setCurrentRound(roundRes.value.data)
      if (previousRes.status === 'fulfilled' && previousRes.value?.data?.bets) {
        setWinners(Array.isArray(previousRes.value.data.bets) ? previousRes.value.data.bets : [])
      }
      if (previousRes.status === 'fulfilled' && previousRes.value?.data != null) {
        setHistory(previousRes.value.data.previous_bets ? [previousRes.value.data] : [])
      }
      if (roundRes.status === 'rejected') setError(roundRes.reason?.message || 'Could not load round data.')
      else if (previousRes.status === 'rejected') setError(previousRes.reason?.message || 'Could not load previous round.')
    } catch (e) {
      setError(e?.message || 'Failed to load game data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPublic()
  }, [])

  if (loading) {
    return (
      <section className="panel public-game-panel">
        <h3>Game &amp; Winners</h3>
        <div className="loading-inline"><span className="spinner" /> Loading…</div>
      </section>
    )
  }

  return (
    <section className="panel public-game-panel">
      <h3>Game &amp; Winners</h3>
      {error && <p className="text-error">{error}</p>}
      {currentRound && (
        <div className="public-game-panel__round">
          <h4>Current round</h4>
          <pre className="round-summary">{JSON.stringify(currentRound, null, 2)}</pre>
        </div>
      )}
      {!currentRound && !error && <p>No current round.</p>}
      {winners.length > 0 && (
        <div className="public-game-panel__winners">
          <h4>Last round bets</h4>
          <ul>
            {winners.map((w, i) => (
              <li key={w.id || i}>{w.player || '***'} — {w.bet ?? w.bet_kes ?? '—'} KES × {w.x ?? w.multiplier ?? '—'} = {w.win ?? w.win_kes ?? '—'} KES</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
