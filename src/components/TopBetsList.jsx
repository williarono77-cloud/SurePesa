import { useState, useMemo, memo } from 'react'
import { formatMoney } from '../utils/formatMoney.js'
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js'
import { supabase } from '../supabaseClient.js'

const TopBetCard = memo(({ item }) => (
  <div className="top-bets-card">
    <div className="top-bets-card__row">
      <div className="top-bets-card__left">
        <div className="top-bets-card__avatar">{item.avatar || item.player?.[0] || '?'}</div>
        <div className="top-bets-card__info">
          <div className="top-bets-card__username">{item.player || item.player_mask || '***'}</div>
          <div className="top-bets-card__date">{item.date || 'Today'}</div>
        </div>
      </div>
      <div className="top-bets-card__right">
        <div className="top-bets-card__multipliers">
          <div className="top-bets-card__result">Result {(item.result || item.result_x || 0).toFixed(2)}x</div>
          <div className="top-bets-card__round-max">Round max. {(item.roundMax || item.round_max_x || 0).toFixed(2)}x</div>
        </div>
        <div className="top-bets-card__icons">
          <button type="button" className="top-bets-card__icon" aria-label="Chat">
            💬
          </button>
          <button type="button" className="top-bets-card__icon" aria-label="Badge">
            ✓
          </button>
        </div>
      </div>
    </div>
    <div className="top-bets-card__row">
      <div className="top-bets-card__amounts">
        <div>
          <span className="top-bets-card__bet-label">Bet </span>
          <span className="top-bets-card__bet-value">{formatMoney(item.bet || item.bet_kes || 0)}</span>
        </div>
        <div>
          <span className="top-bets-card__win-label">Win </span>
          <span className="top-bets-card__win-value">{formatMoney(item.win || item.win_kes || 0)}</span>
        </div>
      </div>
    </div>
  </div>
))

TopBetCard.displayName = 'TopBetCard'

export default function TopBetsList({ data: externalData = null }) {
  const [filter, setFilter] = useState('x')
  const [timeRange, setTimeRange] = useState('day')

  const { data: realtimeData, loading } = useRealtimeFeed('public_top_bets', {
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from('public_top_bets')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)
        return data
      } catch {
        return null
      }
    },
    pollInterval: 3000,
    maxItems: 20,
    useRealtime: true,
    // public_top_bets is a view over game_bets, subscribe to the base table
    eventsTable: 'game_bets',
  })

  const rawData = externalData && externalData.length > 0
    ? externalData
    : Array.isArray(realtimeData) ? realtimeData : []

  // Client-side filtering/sorting (if backend doesn't support it)
  const displayData = useMemo(() => {
    let filtered = [...rawData]
    // Filter by time range (simplified - would need date comparison in real app)
    // Sort by filter type
    if (filter === 'x') {
      filtered.sort((a, b) => (b.result || b.result_x || 0) - (a.result || a.result_x || 0))
    } else if (filter === 'win') {
      filtered.sort((a, b) => (b.win || b.win_kes || 0) - (a.win || a.win_kes || 0))
    }
    return filtered.slice(0, 20)
  }, [rawData, filter, timeRange])

  return (
    <div className="feed-content">
      <div className="top-bets-filters">
        <button
          type="button"
          className={`top-bets-filter ${filter === 'x' ? 'top-bets-filter--active' : ''}`}
          onClick={() => setFilter('x')}
        >
          X
        </button>
        <button
          type="button"
          className={`top-bets-filter ${filter === 'win' ? 'top-bets-filter--active' : ''}`}
          onClick={() => setFilter('win')}
        >
          Win
        </button>
        <button
          type="button"
          className={`top-bets-filter ${filter === 'rounds' ? 'top-bets-filter--active' : ''}`}
          onClick={() => setFilter('rounds')}
        >
          Rounds
        </button>
      </div>

      <div className="top-bets-time">
        <button
          type="button"
          className={`top-bets-time__btn ${timeRange === 'day' ? 'top-bets-time__btn--active' : ''}`}
          onClick={() => setTimeRange('day')}
        >
          Day
        </button>
        <button
          type="button"
          className={`top-bets-time__btn ${timeRange === 'month' ? 'top-bets-time__btn--active' : ''}`}
          onClick={() => setTimeRange('month')}
        >
          Month
        </button>
        <button
          type="button"
          className={`top-bets-time__btn ${timeRange === 'year' ? 'top-bets-time__btn--active' : ''}`}
          onClick={() => setTimeRange('year')}
        >
          Year
        </button>
      </div>

      {filter !== 'x' && filter !== 'win' && (
        <p className="text-muted" style={{ padding: '0 1rem', fontSize: '0.75rem' }}>
          (Client filtered - backend sorting coming soon)
        </p>
      )}

      <div className="top-bets-list">
        {loading && displayData.length === 0 ? (
          <>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="top-bets-card skeleton skeleton-card" />
            ))}
          </>
        ) : (
          displayData.map((item) => <TopBetCard key={item.id || Math.random()} item={item} />)
        )}
      </div>
    </div>
  )
}
