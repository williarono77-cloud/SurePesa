import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { setAuthRole, clearAuthRole } from "./utils/storage.js";

import TopBar from "./components/TopBar.jsx";
import HeaderRow from "./components/HeaderRow.jsx";
import Drawer from "./components/Drawer.jsx";
import GameHeader from "./components/GameHeader.jsx";
import GameCard from "./components/GameCard.jsx";
import BetPanel from "./components/BetPanel.jsx";
import FeedTabs from "./components/FeedTabs.jsx";
import AllBetsTable from "./components/AllBetsTable.jsx";
import PreviousRound from "./components/PreviousRound.jsx";
import TopBetsList from "./components/TopBetsList.jsx";
import AuthModal from "./components/AuthModal.jsx";
import DepositModal from "./components/DepositModal.jsx";
import WithdrawModal from "./components/WithdrawModal.jsx";
import Toast from "./components/Toast.jsx";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import Dashboard from "./components/Dashboard.jsx";
import { fetchActiveRound, advanceRound } from "./utils/gameRounds.js";
const [roleLoading, setRoleLoading] = useState(false);

export default function App() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'user' from profiles; null when logged out
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // UI state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [feedTab, setFeedTab] = useState("all"); // 'all' | 'previous' | 'top'
  const finishedRoundRef = useRef(null);
  const pendingRoundRef = useRef(null);
  const [pendingRound, setPendingRound] = useState(null);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);
  const [roundPhase, setRoundPhase] = useState("break");
  const [panelBets, setPanelBets] = useState({
    top: null,
    bottom: null,
  });

  // Data state
  const [wallet, setWallet] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [showDashboard, setShowDashboard] = useState(false);
  const [demoAllBets, setDemoAllBets] = useState([]);
  const [demoPreviousRound, setDemoPreviousRound] = useState(null);
  const [demoTopBets, setDemoTopBets] = useState([]);

  const [activeRound, setActiveRound] = useState(null);
  const [roundsReady, setRoundsReady] = useState(false);
  const [isBreakOpen, setIsBreakOpen] = useState(false);
  const [bettableRound, setBettableRound] = useState(null);

  const demoRef = useRef({ seed: Math.floor(Math.random() * 1e9), seq: 0 });

  const userId = session?.user?.id ?? null;

  const clearMessage = useCallback(() => setMessage(null), []);

  const refreshPrivateData = useCallback(async () => {
    if (!userId) {
      setWallet(null);
      setDeposits([]);
      return;
    }

    try {
      const [walletRes, depositsRes] = await Promise.all([
        supabase.from("wallets").select("available_cents, locked_cents").eq("user_id", userId).maybeSingle(),
        supabase.from("deposits").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      ]);

      if (walletRes.error || depositsRes.error) {
        setWallet(null);
        setDeposits([]);
        return;
      }
      setWallet(walletRes.data ?? null);
      setDeposits(depositsRes.data ?? []);
    } catch {
      setWallet(null);
      setDeposits([]);
    }
  }, [userId]);

  const generateDemoBetsForRound = useCallback((round, opts = {}) => {
    const burst = Number(round?.burst_point ?? 0);
    const roundNumber = round?.round_number ?? null;
    if (!Number.isFinite(burst) || burst <= 1 || roundNumber == null) return [];

    const count = opts.count ?? 10;
    const nowIso = new Date().toISOString();
    const bets = [];
    for (let i = 0; i < count; i += 1) {
      demoRef.current.seq += 1;
      const stake = Math.round((100 + Math.random() * 4900) / 10) * 10; // KES 100..5000
      const cashout = Number((1 + Math.random() * Math.max(0.01, burst - 0.05)).toFixed(2));
      const didWin = cashout < burst;
      const win = didWin ? Math.round(stake * cashout) : 0;
      bets.push({
        id: `demo-bet-${roundNumber}-${demoRef.current.seq}`,
        player: `Player ${((demoRef.current.seq + demoRef.current.seed) % 99) + 1}`,
        bet_kes: stake,
        multiplier: cashout.toFixed(2),
        win_kes: win,
        created_at: nowIso,
        round_number: roundNumber,
        result_x: burst,
        round_max_x: burst,
      });
    }
    return bets;
  }, []);

function fetchAndSetRole(uid, cancelledRef) {
  if (!uid) {
    setRole(null);
    setRoleLoading(false);
    return;
  }

  setRoleLoading(true);
  setRole(null);

  supabase
    .from("profiles")
    .select("id, role")
    .eq("id", uid)
    .maybeSingle()
    .then(({ data, error }) => {
      if (cancelledRef?.current) return;

      if (error) {
        console.error("Profile role fetch failed", error);
        setRole(null);
        return;
      }

      const normalizedRole =
        typeof data?.role === "string" ? data.role.trim().toLowerCase() : null;

      const resolvedRole = normalizedRole === "admin" ? "admin" : "user";

      console.log("App.jsx: fetched profile role", {
        uid,
        profileId: data?.id ?? null,
        rawRole: data?.role ?? null,
        normalizedRole,
        resolvedRole,
      });

      setRole(resolvedRole);
      setAuthRole(uid, resolvedRole);

      if (resolvedRole === "admin") {
        window.location.replace("/admin.html");
      }
    })
    .catch((err) => {
      if (cancelledRef?.current) return;
      console.error("Profile role fetch failed after login", err);
      setRole(null);
    })
    .finally(() => {
      if (cancelledRef?.current) return;
      setRoleLoading(false);
    });
}

  // Initialize session and role
  useEffect(() => {
    const cancelled = { current: false };

    if (!isSupabaseConfigured) {
      setSession(null);
      setUser(null);
      setRole(null);
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled.current) return;
        const s = data?.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
        if (!s?.user?.id) {
          setRole(null);
          clearAuthRole();
        } else {
          fetchAndSetRole(s.user.id, cancelled);
        }
      })
      .catch(() => {
        if (cancelled.current) return;
        setSession(null);
        setUser(null);
        setRole(null);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user?.id) {
        setRole(null);
        clearAuthRole();
      } else {
        fetchAndSetRole(s.user.id, cancelled);
      }
    });

    return () => {
      cancelled.current = true;
      data?.subscription?.unsubscribe?.();
    };
  }, []);

// Round fetch / refetch pipeline
useEffect(() => {
  if (!isSupabaseConfigured) return;

  let cancelled = false;
  let retryTimer = null;

  const loadActiveRound = async () => {
    if (cancelled) return;

    console.log("loadActiveRound started");

    let active = null;
    let error = null;
    
    try {
      active = await fetchActiveRound();
    } catch (e) {
      error = e;
    }

    console.log("active query result:", { active, error });

    if (cancelled) return;

    if (error) {
      console.error("Fetch active round failed:", error);
      setActiveRound(null);
      setRoundsReady(false);

      retryTimer = setTimeout(() => {
        loadActiveRound();
      }, 1500);
      return;
    }

    if (active) {
      setActiveRound((prev) => {
        if (prev?.id === active.id) return prev;
        return active;
      });
      setRoundsReady(true);
      console.log("state updated with active round");
      return;
    }

    setActiveRound(null);
    setRoundsReady(false);
    console.warn("No active round available yet. Retrying...");

    retryTimer = setTimeout(() => {
      loadActiveRound();
    }, 1000);
  };

  loadActiveRound();

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
  };
}, []);
  // Load private data when session changes
  useEffect(() => {
    if (!userId) {
      setWallet(null);
      setDeposits([]);
      return;
    }
    refreshPrivateData();
  }, [userId, refreshPrivateData]);

  // Redirect admins to the dedicated admin app
useEffect(() => {
  if (loading || roleLoading) return;
  if (!session?.user?.id) return;
  if (role === "admin") {
    window.location.replace("/admin.html");
  }
}, [loading, roleLoading, session, role]);

  // Realtime: wallets
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`wallet-updates:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload?.new) setWallet(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const balance = useMemo(() => (wallet?.available_cents ?? 0) / 100, [wallet?.available_cents]);

  const lastDepositPhone = useMemo(() => (deposits.length > 0 ? deposits[0]?.phone ?? null : null), [deposits]);

  const handleAuthSuccess = useCallback(() => {
    refreshPrivateData();
    setMessage({ type: "success", text: "Welcome! You are now logged in." });
  }, [refreshPrivateData]);

  const handleDepositSuccess = useCallback(() => {
    // Refresh wallet / transactions, then show dashboard so the user can wait for approval there
    refreshPrivateData();
    setShowDashboard(true);
    setDepositModalOpen(false);
  }, [refreshPrivateData]);

const fetchNextWaitingRound = useCallback(async () => {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from("game_rounds")
    .select("*")
    .eq("status", "waiting")
    .order("round_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch next waiting round:", error);
    return null;
  }

  return data ?? null;
}, []);

useEffect(() => {
  let cancelled = false;

  const loadBettableRound = async () => {
    if (!isSupabaseConfigured) {
      setBettableRound(null);
      return;
    }

    if (!isBreakOpen) {
      setBettableRound(null);
      return;
    }

    const nextWaiting = await fetchNextWaitingRound();
    if (!cancelled) {
      setBettableRound(nextWaiting ?? null);
    }
  };

  loadBettableRound();

  return () => {
    cancelled = true;
  };
}, [isBreakOpen, fetchNextWaitingRound]);
  
  const handleLogout = useCallback(async () => {
    try {
      clearAuthRole();
      await supabase.auth.signOut();
    } finally {
      setDrawerOpen(false);
      setMessage({ type: "info", text: "Logged out" });
    }
  }, []);

  const betRound = bettableRound ?? null;
const betRoundPublicId = betRound?.round_id ?? null;
const canBet = isBreakOpen && !!betRoundPublicId;

  const handleRoundStateChange = useCallback((state) => {
    if (state === "rest") {
      setRoundPhase("break");
      return;
    }
  
    if (state === "burst") {
      setRoundPhase("burst");
      return;
    }
  
    setRoundPhase("rising");
  }, []);
  
  const handleRoundBurst = useCallback(
    async (finishedRound) => {
      if (!finishedRound) return;
      setRoundPhase("burst");
      setCurrentMultiplier(Number(finishedRound?.burst_point ?? 1));
      setBettableRound(null);
  
      const hadOpenBets = Object.values(panelBets).some(
        (bet) => bet?.status === "placed"
      );
  
      if (hadOpenBets) {
        setPanelBets((prev) => ({
          top:
            prev.top?.status === "placed"
              ? {
                  ...prev.top,
                  status: "lost",
                  payout: 0,
                  resolvedMultiplier: Number(finishedRound?.burst_point ?? 0),
                }
              : prev.top,
          bottom:
            prev.bottom?.status === "placed"
              ? {
                  ...prev.bottom,
                  status: "lost",
                  payout: 0,
                  resolvedMultiplier: Number(finishedRound?.burst_point ?? 0),
                }
              : prev.bottom,
        }));
  
        setMessage({
          type: "error",
          text: "Round bursted before cashout. Open bets lost.",
        });
      }
  
      if (isSupabaseConfigured) {
        finishedRoundRef.current = finishedRound;
  
        try {
          const promotedRound = await advanceRound(finishedRound.id);
          pendingRoundRef.current = promotedRound ?? null;
          setPendingRound(promotedRound ?? null);
        } catch (error) {
          console.error("advance_round_public failed during burst:", error);
  
          try {
            const active = await fetchActiveRound();
            pendingRoundRef.current = active ?? null;
            setPendingRound(active ?? null);
          } catch (fetchError) {
            console.error("Fallback fetchActiveRound failed during burst:", fetchError);
            pendingRoundRef.current = null;
            setPendingRound(null);
          }
        }
  
        return;
      }
  
      const roundBets = generateDemoBetsForRound(finishedRound, { count: 10 });
  
      setDemoPreviousRound({
        result: Number(finishedRound?.burst_point ?? 0),
        bets: roundBets.map((b) => ({
          id: b.id,
          player: b.player,
          bet_kes: b.bet_kes,
          multiplier: b.multiplier,
          win_kes: b.win_kes,
        })),
      });
  
      setDemoAllBets((prev) => [...roundBets, ...(prev ?? [])].slice(0, 50));
  
      setDemoTopBets((prev) => {
        const merged = [...roundBets, ...(prev ?? [])];
        merged.sort((a, b) => (b.win_kes ?? 0) - (a.win_kes ?? 0));
        return merged.slice(0, 20);
      });
    },
    [generateDemoBetsForRound, panelBets]
  );

  const handleRestComplete = useCallback(async () => {
    if (!isSupabaseConfigured) return;
  
    let nextRound = pendingRoundRef.current;
    setIsBreakOpen(false);
    setBettableRound(null);
  
    if (!nextRound) {
      try {
        nextRound = await fetchActiveRound();
      } catch (error) {
        console.error("fetchActiveRound failed at rest complete:", error);
        nextRound = null;
      }
    }
  
    setActiveRound(nextRound ?? null);
    setRoundsReady(!!nextRound);
    setPendingRound(null);
    setCurrentMultiplier(1);
    setRoundPhase("break");
    
    try {
      const nextWaiting = await fetchNextWaitingRound();
      setBettableRound(nextWaiting ?? null);
    } catch (error) {
      console.error("fetchNextWaitingRound failed at rest complete:", error);
      setBettableRound(null);
    }
    
    setPanelBets({
      top: null,
      bottom: null,
    });
  
    finishedRoundRef.current = null;
    pendingRoundRef.current = null;
  }, [fetchNextWaitingRound]);

  const handleBreakStateChange = useCallback((breakOpen) => {
    const open = Boolean(breakOpen);
    setIsBreakOpen(open);
    setRoundPhase(open ? "break" : "rising");
  }, []);
  
  const handleBetClick = useCallback(
    async (action, stake, side) => {
      if (action === "auth") {
        setAuthModalOpen(true);
        return;
      }
  
      if (!userId) return;
  
      const validSide = side === "top" || side === "bottom" ? side : "top";
      const existingBet = panelBets[validSide] ?? null;
  
 if (action === "cashout") {
  const currentBet = side === "top" ? panelBets.top : panelBets.bottom;

  if (!currentBet || currentBet.status !== "placed") {
    setToast({
      kind: "info",
      message: "Place a bet to play.",
    });
    return;
  }

  if (roundPhase !== "rising") {
    return;
  }

  
        const liveMultiplier = Number(currentMultiplier);
  
        if (!Number.isFinite(liveMultiplier) || liveMultiplier <= 1) {
          setMessage({ type: "error", text: "Invalid cashout multiplier." });
          return;
        }
  
        const payout = Number((existingBet.stake * liveMultiplier).toFixed(2));
  
        setPanelBets((prev) => ({
          ...prev,
          [validSide]: {
            ...existingBet,
            status: "won",
            payout,
            resolvedMultiplier: liveMultiplier,
          },
        }));
  
        setMessage({
          type: "success",
          text: `Cashout captured at ${liveMultiplier.toFixed(2)}x.`,
        });
  
        return;
      }
  
      if (action !== "bet") return;
  
      if (!roundsReady) {
        setMessage({ type: "error", text: "Waiting for rounds." });
        return;
      }
  
        if (!canBet) {
          setMessage({ type: "error", text: "You can only place bets in the break." });
          return;
        }
  
      if (existingBet?.status === "placed") {
        setMessage({ type: "error", text: "You already have an open bet on this panel." });
        return;
      }
  
      if (!canBet) {
        setMessage({ type: "error", text: "No bettable round is ready yet." });
        return;
      }
  
      const stakeNumber = Number(stake);
  
      if (!Number.isFinite(stakeNumber)) {
        setMessage({ type: "error", text: "Invalid stake amount." });
        return;
      }
  
      if (stakeNumber < 100) {
        setMessage({ type: "error", text: "Minimum bet amount is KSh 100." });
        return;
      }
  
      const available = (wallet?.available_cents ?? 0) / 100;
  
      if (stakeNumber > available) {
        setMessage({ type: "error", text: "Insufficient balance." });
        return;
      }
  
      const roundIdText = betRoundPublicId ? String(betRoundPublicId) : "";
  
      if (!roundIdText) {
        setMessage({ type: "error", text: "No bettable round available." });
        return;
      }
  
      try {
        const stakeCents = Math.round(stakeNumber * 100);
  
        const { data, error } = await supabase.rpc("game_place_bet", {
          p_round_id: roundIdText,
          p_side: validSide,
          p_stake_cents: stakeCents,
        });
  
        if (error) throw error;
  
        setPanelBets((prev) => ({
          ...prev,
          [validSide]: {
            betId: data ?? null,
            side: validSide,
            roundId: roundIdText,
            stake: stakeNumber,
            stakeCents,
            status: "placed",
            payout: null,
            resolvedMultiplier: null,
          },
        }));
  
        setMessage({
          type: "success",
          text: `Bet placed (${validSide}) for KSh ${stakeNumber.toFixed(2)}.`,
        });
  
        refreshPrivateData();
      } catch (e) {
        const msg = e?.message ?? "";
  
        if (msg.includes("INSUFFICIENT_FUNDS")) {
          setMessage({ type: "error", text: "Insufficient balance." });
        } else if (msg.includes("BETTING_CLOSED")) {
          setMessage({ type: "error", text: "Betting closed for this round." });
        } else {
          setMessage({ type: "error", text: msg || "Failed to place bet." });
        }
      }
    },
    [
      userId,
      panelBets,
      roundPhase,
      currentMultiplier,
      roundsReady,
      canBet,
      wallet?.available_cents,
      betRoundPublicId,
      refreshPrivateData,
    ]
  );

if (loading || (session?.user?.id && roleLoading)) {
  return <LoadingOverlay text="Loading..." />;
}

  return (
    <div className={`app ${fullscreen ? "app--fullscreen" : ""}`}>
     <Toast message={message} onDismiss={clearMessage} />
     <TopBar
        onBack={() => {}}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        onDepositClick={() => setDepositModalOpen(true)}
      />

      <HeaderRow
        balance={userId ? balance : null}
        onMenuClick={() => setDrawerOpen(true)}
        onChatClick={() => setMessage({ type: "info", text: "Chat coming soon" })}
        onAuthClick={() => setAuthModalOpen(true)}
      />

      {showDashboard ? (
        <Dashboard
          user={user}
          setMessage={setMessage}
          onBackToGame={() => setShowDashboard(false)}
          onDepositClick={() => setDepositModalOpen(true)}
        />
      ) : (
        <>
          <GameHeader />
          
          {!roundsReady && (
            <div className="message-banner message-banner--error" role="status" style={{ margin: "0 1rem 1rem" }}>
              Waiting for a live round from the server.
            </div>
          )}
        <GameCard
          key={activeRound?.id ?? "no-round"}
          round={activeRound}
          burstPoint={activeRound?.burst_point ?? null}
          onMultiplierUpdate={setCurrentMultiplier}
          onBurst={handleRoundBurst}
          onBreakStateChange={handleBreakStateChange}
          onRestComplete={handleRestComplete}
        />
          
          <BetPanel
            panelId="1"
            side="top"
            session={session}
            onBetClick={handleBetClick}
            disabled={!canBet && roundPhase !== "rising"}
            roundPhase={roundPhase}
            activeBet={panelBets.top}
            currentMultiplier={currentMultiplier}
          />
          
          <BetPanel
            panelId="2"
            side="bottom"
            session={session}
            onBetClick={handleBetClick}
            disabled={!canBet && roundPhase !== "rising"}
            roundPhase={roundPhase}
            activeBet={panelBets.bottom}
            currentMultiplier={currentMultiplier}
          />
          
          <FeedTabs activeTab={feedTab} onTabChange={setFeedTab} />
          {feedTab === "all" && <AllBetsTable bets={!isSupabaseConfigured ? demoAllBets : null} />}
          {feedTab === "previous" && <PreviousRound data={!isSupabaseConfigured ? demoPreviousRound : null} />}
          {feedTab === "top" && <TopBetsList data={!isSupabaseConfigured ? demoTopBets : null} />}
        </>
      )}

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={session}
        user={user}
        role={role}
        onDepositClick={() => setDepositModalOpen(true)}
        onWithdrawClick={() => setWithdrawModalOpen(true)}
        onAuthClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} onSuccess={handleAuthSuccess} />

      <DepositModal
        isOpen={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        onSubmitted={() => {
          setMessage({ type: "info", text: "Payment request sent. Check your phone to complete payment." });
        }}
        onApproved={() => {
          refreshPrivateData();
          setDepositModalOpen(false);
          setShowDashboard(true);
          setMessage({ type: "success", text: "Deposit confirmed. Wallet updated." });
        }}
      />

      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        userId={user?.id}
        balance={balance}
        lastDepositPhone={lastDepositPhone}
        onWithdrawSuccess={refreshPrivateData}
        setMessage={setMessage}
      />
    </div>
  );
}



