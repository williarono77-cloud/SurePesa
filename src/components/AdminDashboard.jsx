import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../supabaseClient.js'
import { fetchActiveRound } from "../utils/gameRounds.js";
import ThemeToggle from './ThemeToggle.jsx'

const LEDGER_LIMIT = 50
const DEMO_ROUNDS = 12

function formatKes(cents) {
  return ((cents ?? 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KES'
}

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdminDashboard({ user, setMessage, onNotAdmin }) {

  const isLocalDemo = !isSupabaseConfigured
  
  const [profileRole, setProfileRole] = useState(null)
  const [guardLoading, setGuardLoading] = useState(true)
  const [withdrawals, setWithdrawals] = useState([])
  const [withdrawalsError, setWithdrawalsError] = useState(null)
  const [deposits, setDeposits] = useState([])
  const [depositsError, setDepositsError] = useState(null)
  const [ledger, setLedger] = useState([])
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerUserId, setLedgerUserId] = useState('')
  const [processingId, setProcessingId] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmConfig, setConfirmConfig] = useState(null)
  const [stats, setStats] = useState({ totalUsers: null, totalBalanceCents: null })
  const [roundsQueueAdmin, setRoundsQueueAdmin] = useState([])
  const [roundsQueueError, setRoundsQueueError] = useState(null)
  const [roundsQueueLoading, setRoundsQueueLoading] = useState(false)
  const [liveRoundNumber, setLiveRoundNumber] = useState(null)
  const [recentBursted, setRecentBursted] = useState([])
  const isGeneratingRef = useRef(false)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [activeRound, setActiveRound] = useState(null);
const [roundsReady, setRoundsReady] = useState(false);
// ...


const generateDemoRounds = useCallback(() => {
  // ... rest of the file continues normally
    const base = Math.floor(Date.now() / 1000) % 100000
    return Array.from({ length: DEMO_ROUNDS }).map((_, i) => {
      const round_number = base + i + 1
      const burst_point = Number((1.3 + Math.random() * 8.7).toFixed(2)) // 1.30x - 10.00x
      return { id: `demo-${round_number}`, round_id: `demo-${round_number}`, round_number, burst_point }
    })
  }, [])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    window.location.replace('/')
  }, [])

  // Admin guard: only profile.role === 'admin'
  useEffect(() => {
    if (isLocalDemo) {
      setProfileRole('admin')
      setGuardLoading(false)
      return
    }
    if (!user?.id) {
      setGuardLoading(false)
      setProfileRole(null)
      return
    }
    let cancelled = false
    if (!isSupabaseConfigured) {
      setGuardLoading(false)
      setProfileRole(null)
      return () => { cancelled = true }
    }
    try {
      supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return
        
          if (error) {
            console.error('AdminDashboard: profile role fetch failed', error)
            setMessage?.({ type: 'error', text: 'Could not verify access.' })
            setProfileRole(null)
            return
          }
        
          const normalizedRole =
            typeof data?.role === 'string'
              ? data.role.trim().toLowerCase()
              : null
        
          console.log('AdminDashboard: fetched profile role', {
            userId: user.id,
            rawRole: data?.role ?? null,
            normalizedRole,
          })
        
          setProfileRole(normalizedRole)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('AdminDashboard: profile role fetch threw', err)
          setMessage?.({ type: 'error', text: 'Could not verify access.' })
          setProfileRole(null)
        })
        .finally(() => {
          if (!cancelled) setGuardLoading(false)
        })
    } catch (err) {
      console.error('AdminDashboard: profile role fetch threw synchronously', err)
      if (!cancelled) {
        setMessage?.({ type: 'error', text: 'Could not verify access.' })
        setProfileRole(null)
        setGuardLoading(false)
      }
    }
    return () => { cancelled = true }
  }, [user?.id])

  // Redirect non-admin
  useEffect(() => {
    if (isLocalDemo) return
    if (!isSupabaseConfigured) return
    if (guardLoading) return
    if (!user) {
      if (onNotAdmin) onNotAdmin()
      else window.location.replace('/')
      return
    }
    if (profileRole !== 'admin') {
      if (onNotAdmin) onNotAdmin()
      else window.location.replace('/')
    }
  }, [guardLoading, user, profileRole, onNotAdmin])

  const fetchWithdrawals = useCallback(async () => {
    setWithdrawalsError(null)
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('id, amount_cents, phone, created_at')
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
    if (error) {
      setWithdrawalsError(error.message)
      setWithdrawals([])
      return
    }
    setWithdrawals(data ?? [])
  }, [])

  const fetchDeposits = useCallback(async () => {
    setDepositsError(null)
  
    const { data, error } = await supabase
      .from('deposits')
      .select('id, user_id, amount_cents, external_ref, phone, created_at, status')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20)
  
    if (error) {
      setDepositsError(error.message)
      setDeposits([])
      return
    }
  
    setDeposits(data ?? [])
  }, [])

const fetchLedger = useCallback(async () => {
  setLedgerError(null)

  let q = supabase
    .from('ledger')
    .select('id, user_id, type, amount_cents, before_available_cents, after_available_cents, before_locked_cents, after_locked_cents, created_at, reference_table, reference_id')
    .order('created_at', { ascending: false })
    .limit(LEDGER_LIMIT)

  if (ledgerUserId?.trim()) {
    q = q.eq('user_id', ledgerUserId.trim())
  }

  const { data, error } = await q

  if (error) {
    setLedgerError(error.message)
    setLedger([])
    return
  }

  setLedger(data ?? [])
}, [ledgerUserId])
  
  const fetchStats = useCallback(async () => {
  try {
    const [profilesRes, walletsRes] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('wallets').select('available_cents, locked_cents'),
    ])

    if (profilesRes?.error || walletsRes?.error) {
      setStats({ totalUsers: null, totalBalanceCents: null })
      return
    }

    const totalUsers = profilesRes?.count ?? 0
    let totalBalanceCents = 0

    if (walletsRes?.data && Array.isArray(walletsRes.data)) {
      totalBalanceCents = walletsRes.data.reduce(
        (sum, wallet) => sum + (wallet.available_cents ?? 0) + (wallet.locked_cents ?? 0),
        0
      )
    }

    setStats({ totalUsers, totalBalanceCents })
  } catch {
    setStats({ totalUsers: null, totalBalanceCents: null })
  }
}, [])

//////
const refreshAdminActiveRound = useCallback(async () => {
  try {
    if (!isSupabaseConfigured) {
      setActiveRound(null);
      setLiveRoundNumber(null);
      setRoundsReady(false);
      return;
    }

    const { data, error } = await supabase
      .from("game_rounds")
      .select("*")
      .eq("status", "active")
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    setActiveRound(data ?? null);
    setLiveRoundNumber(data?.round_number ?? null);
    setRoundsReady(!!data);
  } catch (error) {
    console.error("Admin active round refresh failed:", error);
    setActiveRound(null);
    setLiveRoundNumber(null);
    setRoundsReady(false);
  }
}, []);
  
  const fetchAdminRoundsQueue = useCallback(async () => {
    setRoundsQueueError(null)
    setRoundsQueueLoading(true)
    try {
      if (isLocalDemo) {
        const queue = generateDemoRounds()
        setRoundsQueueAdmin(queue)
        return
      }
      const { data, error } = await supabase
        .from('next_rounds_admin')
        .select('id, round_id, round_number, burst_point, status')
        .order('round_number', { ascending: true })
        .limit(12)
      console.log('AdminDashboard: next_rounds_admin response', { data, error })
      if (error) throw error

      const queue = data ?? []
      console.log('AdminDashboard: rounds queue parsed', queue)
      setRoundsQueueAdmin(queue)
    } catch (e) {
      setRoundsQueueError(e?.message || 'Failed to load rounds queue')
      setRoundsQueueAdmin([])
    } finally {
      setRoundsQueueLoading(false)
    }
  }, [])

  const refreshAdminRoundData = useCallback(async () => {
  await Promise.all([
    fetchAdminRoundsQueue(),
    refreshAdminActiveRound(),
  ]);
}, [fetchAdminRoundsQueue, refreshAdminActiveRound]);
  
const fetchRecentBurstedRounds = useCallback(async () => {
  if (!isSupabaseConfigured) return

  const { data, error } = await supabase
    .from('game_rounds')
    .select('round_number, burst_point, status, ended_at')
    .in('status', ['ended', 'bursted'])
    .order('ended_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Failed to fetch recent bursted rounds:', error)
    return
  }

  setRecentBursted(Array.isArray(data) ? data : [])
}, [])

const fetchLiveRound = useCallback(async () => {
  if (!isSupabaseConfigured) return

  const { data, error } = await supabase
    .from('game_rounds')
    .select('round_number, status')
    .in('status', ['active', 'live'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch live round:', error)
    setLiveRoundNumber(null)
    return
  }

  setLiveRoundNumber(data?.round_number ?? null)
}, [])
  
    const generateWaitingRounds = useCallback(async (count = 12) => {
    if (isGeneratingRef.current) {
      console.warn('Generation already in progress — skipping')
      return
    }
  
    isGeneratingRef.current = true
  
    try {
      const { data: latestRound, error: latestRoundError } = await supabase
        .from('game_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (latestRoundError) {
        console.error('Failed to read latest round:', latestRoundError)
        setMessage?.({ type: 'error', text: 'Failed to read latest round number.' })
        return
      }
      
      const nextRoundNumberStart = (latestRound?.round_number ?? 0) + 1
      const createdAt = new Date().toISOString()
  
      const newRounds = Array.from({ length: count }, (_, i) => {
        const roundNumber = nextRoundNumberStart + i
        const burst = Number((1.8 + Math.random() * 13.2).toFixed(2))
  
        return {
          round_id: crypto.randomUUID(),
          round_number: roundNumber,
          burst_point: burst,
          status: 'waiting',
          created_at: createdAt,
        }
      })
  
      const { error: insertError } = await supabase
        .from('game_rounds')
        .insert(newRounds)
  
      if (insertError) {
        console.error('Insert failed:', insertError)
        setMessage?.({ type: 'error', text: 'Failed to generate rounds: ' + insertError.message })
        return
      }
  
      setGeneratedCount((prev) => {
        const next = prev + count
        console.log(`Admin generated ${count} waiting rounds (total generated: ${next})`)
        return next
      })
  
     await fetchAdminRoundsQueue()
      await fetchRecentBurstedRounds()
    } catch (err) {
      console.error('Generator crashed:', err)
      setMessage?.({ type: 'error', text: 'Round generation error' })
    } finally {
      isGeneratingRef.current = false
    }
}, [setMessage, fetchAdminRoundsQueue, fetchRecentBurstedRounds])


    const handleRefreshAll = useCallback(async () => {
      await Promise.all([
        fetchWithdrawals(),
        fetchDeposits(),
        fetchLedger(),
        fetchStats(),
        fetchAdminRoundsQueue(),
        fetchRecentBurstedRounds(),
        fetchLiveRound(),
      ])
    }, [
      fetchWithdrawals,
      fetchDeposits,
      fetchLedger,
      fetchStats,
      fetchAdminRoundsQueue,
      fetchRecentBurstedRounds,
      fetchLiveRound,
    ])
  
  // Auto-refill scheduled queue when it drops below 3
    useEffect(() => {
    if (!isSupabaseConfigured) return
  
    let cancelled = false
  
    const checkAndRefillWaitingRounds = async () => {
      if (isGeneratingRef.current) return
  
      const { data, error } = await supabase
        .from('game_rounds')
        .select('round_number, status')
        .eq('status', 'waiting')
        .order('round_number', { ascending: true })
        .limit(8)
  
      if (cancelled) return
  
      if (error) {
        console.error('Failed to check waiting rounds:', error)
        return
      }
  
      const waitingCount = Array.isArray(data) ? data.length : 0
  
      if (waitingCount <= 3) {
        console.log(`Waiting rounds low (${waitingCount}) → generating 12 more`)
        await generateWaitingRounds(12)
      }
    }
  
    checkAndRefillWaitingRounds()
    const id = window.setInterval(checkAndRefillWaitingRounds, 5000)
  
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [generateWaitingRounds])

useEffect(() => {
  if (!isSupabaseConfigured) return
  if (profileRole !== 'admin') return

  fetchWithdrawals()
  fetchDeposits()
  fetchLedger()
  fetchStats()
  fetchAdminRoundsQueue()
  fetchRecentBurstedRounds()
  refreshAdminActiveRound()
}, [
  profileRole,
  fetchWithdrawals,
  fetchDeposits,
  fetchLedger,
  fetchStats,
  fetchAdminRoundsQueue,
  fetchRecentBurstedRounds,
  refreshAdminActiveRound,
])
    // Realtime: withdrawal_requests and deposits
useEffect(() => {
  if (isLocalDemo) return
  if (!isSupabaseConfigured || profileRole !== 'admin') return

  const channel = supabase
    .channel('admin-updates')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'withdrawal_requests' },
      () => fetchWithdrawals()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'deposits' },
      () => fetchDeposits()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_rounds' },
      () => {
        fetchAdminRoundsQueue()
        fetchRecentBurstedRounds()
        refreshAdminActiveRound()
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [
  isLocalDemo,
  isSupabaseConfigured,
  profileRole,
  fetchWithdrawals,
  fetchDeposits,
  fetchAdminRoundsQueue,
  fetchRecentBurstedRounds,
  refreshAdminActiveRound,
])

useEffect(() => {
  if (!isSupabaseConfigured) return
  if (profileRole !== 'admin') return

  const channel = supabase
    .channel('admin:rounds', { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, () => {
      refreshAdminRoundData()
    })
    .on('broadcast', { event: 'UPDATE' }, () => {
      refreshAdminRoundData()
    })
    .on('broadcast', { event: 'DELETE' }, () => {
      refreshAdminRoundData()
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [profileRole, refreshAdminRoundData])
  
  // Local demo: auto-generate + broadcast rounds on mount
  useEffect(() => {
    if (!isLocalDemo) return
    fetchAdminRoundsQueue()
  }, [isLocalDemo, fetchAdminRoundsQueue])

  const openConfirm = (action, requestId, label, inputLabel, placeholder, submitLabel) => {
    setConfirmConfig({
      action,
      requestId,
      label,
      inputLabel,
      placeholder: placeholder ?? '',
      submitLabel,
      value: '',
    })
    setConfirmOpen(true)
  }

  const closeConfirm = () => {
    setConfirmOpen(false)
    setConfirmConfig(null)
  }

  const handleConfirmSubmit = async () => {
    if (!confirmConfig) return;
  
    const { action, requestId, value } = confirmConfig;
    setProcessingId(requestId);
  
    try {
      let error = null;
  
      if (action === "reject") {
        const res = await supabase.rpc("admin_withdraw_reject", {
          p_request_id: requestId,
          p_admin_note: value.trim(),
        });
        error = res.error;
      } else {
        const res = await supabase.rpc("admin_withdraw_mark_paid", {
          p_request_id: requestId,
          p_paid_ref: value.trim(),
        });
        error = res.error;
      }
  
      if (error) {
        setMessage?.({ type: "error", text: error.message });
      } else {
        if (action === "reject") {
          setMessage?.({ type: "success", text: "Withdrawal rejected." });
        } else {
          setMessage?.({ type: "success", text: "Marked as paid." });
        }
  
        closeConfirm();
        fetchWithdrawals();
      }
    } catch (e) {
      setMessage?.({ type: "error", text: e?.message || "Action failed" });
    } finally {
      setProcessingId(null);
    }
  };

  if (guardLoading || profileRole !== 'admin') {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__header">
          <h1 className="admin-dashboard__title">Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard__loading">Checking access…</div>
      </div>
    )
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard__header">
        <h1 className="admin-dashboard__title">Admin Dashboard</h1>
        <nav className="admin-dashboard__nav" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <a href="/" className="admin-dashboard__nav-link" style={{ color: 'var(--accent-green)', textDecoration: 'none', fontWeight: 600 }}>Back to app</a>
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={handleRefreshAll}>
            Refresh All
          </button>
          <ThemeToggle />
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <div style={{ margin: '1rem 0', display: 'flex', gap: '1rem' }}>
          <button 
            type="button" 
            className="admin-dashboard__btn admin-dashboard__btn--primary"
            onClick={() => generateWaitingRounds(12)}
          >
            Generate 12 Rounds Now
          </button>
        </div>


      
      {/* Analytics */}
      <section className="admin-dashboard__grid" aria-label="Analytics">
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{stats.totalUsers ?? '—'}</div>
          <div className="admin-dashboard__stat-label">Total users</div>
        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{stats.totalBalanceCents != null ? formatKes(stats.totalBalanceCents) : '—'}</div>
          <div className="admin-dashboard__stat-label">Platform balance</div>
        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{deposits.length}</div>
        <div className="admin-dashboard__stat-label">Active deposit records</div>        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{withdrawals.length}</div>
          <div className="admin-dashboard__stat-label">Pending withdrawals</div>
        </div>
      </section>

      {/* Live round from user page */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Live round (from server)</h3>
        <div className="admin-dashboard__next-round">
          <div
            className="admin-dashboard__preview-card"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
              background: 'var(--surface-subtle, rgba(15,23,42,0.9))',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              fontSize: '0.8rem',
            }}
          >
            <div style={{ fontWeight: 600 }}>
             {activeRound?.burst_point != null ? `${Number(activeRound.burst_point).toFixed(2)}x` : 'No live round'}
            </div>
            {activeRound?.round_number != null && (
              <div style={{ opacity: 0.8 }}>
                Tracking via realtime from server.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Scheduled rounds queue */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Scheduled rounds queue</h3>
        {roundsQueueError && <p className="text-error admin-dashboard__error">{roundsQueueError}</p>}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
          }}
        >

          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
            Scheduled queue from database. Auto-refills when 3 or fewer waiting rounds remain.          </span>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', minHeight: '4.5rem' }}>
            {roundsQueueAdmin.length === 0 ? (
              <div className="admin-dashboard__empty">No scheduled rounds.</div>
            ) : (
              roundsQueueAdmin.slice(0, 12).map((r) => {
                const rn = r?.round_number ?? null
                const status = String(r?.status ?? 'waiting').toUpperCase()
                return (
                <div
                  key={r?.id ?? rn}
                  style={{
                    minWidth: '140px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--accent-blue, #3b82f6)',
                    background: 'var(--surface-subtle, rgba(15,23,42,0.85))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Round #{rn ?? '—'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Burst</span>
                    <span>{r?.burst_point != null ? `${Number(r.burst_point).toFixed(2)}x` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Status</span>
                    <span style={{ color: 'var(--accent-blue, #3b82f6)', fontWeight: 700 }}>{status}</span>
                  </div>
                </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* Recent bursted */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Recent bursted</h3>
        <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', minHeight: '4.5rem' }}>
            {recentBursted.length === 0 ? (
              <div className="admin-dashboard__empty">No bursted rounds yet.</div>
            ) : (
              [...recentBursted].slice(0, 12).map((row) => (
                <div
                  key={`${row?.round_number ?? 'x'}-${row?.ended_at ?? 'no-ended-at'}`}
                  style={{
                    minWidth: '140px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--accent-red, #ef4444)',
                    background: 'var(--surface-subtle, rgba(15,23,42,0.85))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                    Round #{row?.round_number ?? '—'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Burst</span>
                    <span>{row?.burst_point != null ? `${Number(row.burst_point).toFixed(2)}x` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Status</span>
                    <span style={{ color: 'var(--accent-red, #ef4444)', fontWeight: 700 }}>
                      {String(row?.status ?? 'ended').toUpperCase()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Deposit queue */}
        {/* Deposit monitor */}
        <div className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
          <h3 className="admin-dashboard__card-title">Deposit Monitor</h3>
          {depositsError && <p className="text-error admin-dashboard__error">{depositsError}</p>}
          {deposits.length === 0 && !depositsError && (
            <div className="admin-dashboard__empty">No active deposit records</div>
          )}
          {deposits.length > 0 && (
            <div className="admin-dashboard__table-wrap">
              <table className="admin-dashboard__table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Reference</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id}>
                      <td>{formatKes(d.amount_cents)}</td>
                      <td>{d.external_ref || '-'}</td>
                      <td>{d.phone ?? '-'}</td>
                      <td>{d.status ?? 'pending'}</td>
                      <td>{formatDate(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Withdrawal queue */}
      <div className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Withdrawal Queue</h3>
        {withdrawalsError && <p className="text-error admin-dashboard__error">{withdrawalsError}</p>}
        {withdrawals.length === 0 && !withdrawalsError && (
          <div className="admin-dashboard__empty">No pending withdrawals</div>
        )}
        {withdrawals.length > 0 && (
          <div className="admin-dashboard__table-wrap">
            <table className="admin-dashboard__table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Phone</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((r) => (
                  <tr key={r.id}>
                    <td>{formatKes(r.amount_cents)}</td>
                    <td>{r.phone ?? '-'}</td>
                    <td>{formatDate(r.created_at)}</td>
                    <td>
                      <div className="admin-dashboard__actions">
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--reject"
                          disabled={!!processingId}
                          onClick={() => openConfirm('reject', r.id, 'Reject withdrawal', 'Admin note', 'Reason for rejection', 'Reject')}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--pay"
                          disabled={!!processingId}
                          onClick={() => openConfirm('pay', r.id, 'Mark as paid', 'Payment reference (e.g. M-Pesa code)', 'e.g. ABC123XYZ', 'Mark Paid')}
                        >
                          Mark Paid
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ledger view */}
      <div className="admin-dashboard__card admin-dashboard__card--wide">
        <h3 className="admin-dashboard__card-title">Ledger (last {LEDGER_LIMIT})</h3>
        <div className="admin-dashboard__ledger-filter">
          <label>
            <span className="admin-dashboard__filter-label">Filter by user_id:</span>
            <input
              type="text"
              className="admin-dashboard__input"
              placeholder="UUID or empty for all"
              value={ledgerUserId}
              onChange={(e) => setLedgerUserId(e.target.value)}
              onBlur={fetchLedger}
            />
          </label>
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={fetchLedger}>
            Refresh
          </button>
        </div>
        {ledgerError && <p className="text-error admin-dashboard__error">{ledgerError}</p>}
        <div className="admin-dashboard__table-wrap">
          <table className="admin-dashboard__table admin-dashboard__table--ledger">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Before (avail / locked)</th>
                <th>After (avail / locked)</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.type ?? '-'}</td>
                  <td>{formatKes(row.amount_cents)}</td>
                  <td>{row.before_available_cents != null ? `${formatKes(row.before_available_cents)} / ${formatKes(row.before_locked_cents)}` : '-'}</td>
                  <td>{row.after_available_cents != null ? `${formatKes(row.after_available_cents)} / ${formatKes(row.after_locked_cents)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

        {/* Confirm dialog */}
        {confirmOpen && confirmConfig && (
          <div className="modal-overlay" onClick={closeConfirm}>
            <div className="modal admin-dashboard__confirm" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal__title">{confirmConfig.label}</h3>
              <p className="admin-dashboard__confirm-label">{confirmConfig.inputLabel}</p>
  
              <input
                type="text"
                className="modal__input"
                placeholder={confirmConfig.placeholder}
                value={confirmConfig.value}
                onChange={(e) => setConfirmConfig((c) => (c ? { ...c, value: e.target.value } : c))}
              />
  
              <div className="admin-dashboard__confirm-actions">
                <button
                  type="button"
                  className="admin-dashboard__btn admin-dashboard__btn--secondary"
                  onClick={closeConfirm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-dashboard__btn admin-dashboard__btn--pay"
                  disabled={!confirmConfig.value?.trim() || !!processingId}
                  onClick={handleConfirmSubmit}
                >
                  {processingId ? "Processing…" : confirmConfig.submitLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
// DEBUG TELEMETRY REMOVED - no more 127.0.0.1:7736 calls










