import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient.js'

/**
 * Hook for real-time feed updates with Supabase Realtime or polling fallback.
 * @param {string} tableName - Supabase table or view name used by the fetch query
 * @param {object} options - Configuration
 * @param {function} options.queryFn - Function to fetch data (returns Promise)
 * @param {number} options.pollInterval - Polling interval in ms (default: 3000)
 * @param {number} options.maxItems - Maximum items to keep when result is an array (default: 50)
 * @param {boolean} options.useRealtime - Whether to use Realtime (default: true if available)
 * @param {string} [options.eventsTable] - Optional base table name to subscribe to for realtime events
 *                                         (useful when tableName is a view like public_all_bets_feed).
 */
export function useRealtimeFeed(
  tableName,
  { queryFn, pollInterval = 3000, maxItems = 50, useRealtime = true, eventsTable = null }
) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)
  const pollTimerRef = useRef(null)
  const isVisibleRef = useRef(true)
  const queryFnRef = useRef(queryFn)

  // Update queryFn ref when it changes
  useEffect(() => {
    queryFnRef.current = queryFn
  }, [queryFn])

  useEffect(() => {
    // Pause polling when tab is hidden
    function handleVisibilityChange() {
      isVisibleRef.current = !document.hidden
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    let mounted = true

    async function fetchData() {
      if (!isVisibleRef.current) return
      try {
        const result = await queryFnRef.current()
        if (mounted && result != null) {
          if (Array.isArray(result)) {
            setData(result.slice(0, maxItems))
          } else {
            // Allow single-object payloads for views like previous_round
            setData(result)
          }
          setLoading(false)
        }
      } catch {
        if (mounted) setLoading(false)
      }
    }

    // Initial fetch
    fetchData()

    const realtimeTable = eventsTable || tableName

    // Try Realtime subscription (can target a base table even if tableName is a view)
    if (useRealtime && supabase && realtimeTable) {
      try {
        const channel = supabase
          .channel(`${tableName}_changes`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: realtimeTable,
            },
            () => {
              // On any change (INSERT, UPDATE, DELETE), refetch the full dataset
              // This ensures we always have the latest data in correct order
              if (mounted && isVisibleRef.current) {
                fetchData()
              }
            }
          )
          .subscribe()

        channelRef.current = channel
      } catch {
      }
    }

    // Polling fallback (or if Realtime failed)
    if (!channelRef.current || !useRealtime) {
      pollTimerRef.current = setInterval(() => {
        if (isVisibleRef.current) {
          fetchData()
        }
      }, pollInterval)
    }

    return () => {
      mounted = false
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [tableName, pollInterval, maxItems, useRealtime, eventsTable])

  return { data, loading }
}
