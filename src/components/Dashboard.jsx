import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient.js";
import WithdrawPanel from "./WithdrawPanel.jsx";
import TransactionsPanel from "./TransactionsPanel.jsx";
import PublicGamePanel from "./PublicGamePanel.jsx";

export default function Dashboard({ user, setMessage, onBackToGame, onDepositClick }) {
  const [wallet, setWallet] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setWallet(null);
      setDeposits([]);
      setWithdrawals([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);

    try {
      const [walletRes, depositsRes, withdrawalsRes] = await Promise.all([
        supabase
          .from("wallets")
          .select("available_cents, locked_cents")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("deposits")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("withdrawal_requests")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (walletRes.error || depositsRes.error || withdrawalsRes.error) {
        setWallet(null);
        setDeposits([]);
        setWithdrawals([]);
        return;
      }

      setWallet(walletRes.data ?? null);
      setDeposits(depositsRes.data ?? []);
      setWithdrawals(withdrawalsRes.data ?? []);
    } catch (e) {
      setWallet(null);
      setDeposits([]);
      setWithdrawals([]);
      setMessage?.({ type: "error", text: e?.message || "Failed to load data" });
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [user?.id, setMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const balance = wallet ? (wallet.available_cents ?? 0) / 100 : 0;
  const lastDepositPhone = deposits.length > 0 ? deposits[0]?.phone : null;

  return (
    <main className="dashboard container">
      {onBackToGame ? (
        <div className="dashboard__nav" style={{ marginBottom: "1rem" }}>
          <button type="button" className="btn btn--secondary" onClick={onBackToGame}>
            ← Back to game
          </button>
        </div>
      ) : null}

      <div
        className="dashboard__top"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div className="wallet-display">
          <span className="wallet-display__label">Wallet balance</span>
          <span className="wallet-display__value">{loading ? "…" : balance}</span>
          <span className="wallet-display__hint">
            Balance updates automatically after payment confirmation.
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (onDepositClick) onDepositClick();
            }}
          >
            Deposit
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <WithdrawPanel
        userId={user?.id}
        balance={balance}
        lastDepositPhone={lastDepositPhone}
        onWithdrawSuccess={refresh}
        setMessage={setMessage}
      />

      <TransactionsPanel deposits={deposits} withdrawals={withdrawals} />

      <PublicGamePanel />
    </main>
  );
}
