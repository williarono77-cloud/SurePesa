import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js'
import { supabase } from '../supabaseClient.js'

export default function GameHeader({ multipliers: externalMultipliers = [] }) {
  const { data: realtimeMultipliers } = useRealtimeFeed('recent_multipliers', {
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from('recent_multipliers')
          .select('*')
          .order('id', { ascending: false })
          .limit(10)
        return data
      } catch {
        return null
      }
    },
    pollInterval: 2500,
    maxItems: 10,
    useRealtime: true,
    // recent_multipliers is a view backed by game_rounds
    eventsTable: 'game_rounds',
  })

  // Combine external and realtime data
  let displayMultipliers = externalMultipliers.length > 0 ? externalMultipliers : []
  if (realtimeMultipliers && realtimeMultipliers.length > 0) {
    displayMultipliers = realtimeMultipliers
      .map((m) => {
        const raw =
          m.multiplier ??
          m.value ??
          m.burst_point ??
          m.result ??
          m.round_result

        if (raw == null) return null

        const num = Number(raw)
        if (!Number.isFinite(num)) return null

        return `${num.toFixed(2)}x`
      })
      .filter(Boolean)
  }

  return (
    <div className="game-header">
      <div className="game-header__top">
        <div className="game-header__live">
          <span>▶</span>
          <span>LIVE</span>
        </div>
        <h2 className="game-header__title">Collect Highest Multiplier</h2>
        <button type="button" className="game-header__arrow-btn">→</button>
      </div>
      <div className="game-header__multipliers-row">
        <div className="game-header__multipliers">
          {displayMultipliers.map((mult, i) => (
            <span key={i} className="game-header__multiplier">
              {mult}
            </span>
          ))}
          <button type="button" className="game-header__more">…</button>
        </div>
      </div>
    </div>
  )
}



