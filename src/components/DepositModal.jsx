import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { getAppConfigValue } from "../utils/appConfig";

  export default function DepositModal({ isOpen, onClose, onSubmitted, onApproved }) {
  const [loading, setLoading] = useState(false);

  const [mpesaNumber, setMpesaNumber] = useState("07XXXXXXXX");
  const [mpesaNote, setMpesaNote] = useState("");

  const [amount, setAmount] = useState("");
  const [depositId, setDepositId] = useState(null);

  const [mpesaRef, setMpesaRef] = useState("");
  const [status, setStatus] = useState("idle"); // idle | created | submitted
  const [message, setMessage] = useState(null);

  const amountCents = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }, [amount]);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(false);
    setDepositId(null);
    setMpesaRef("");
    setStatus("idle");
    setMessage(null);

    let cancelled = false;

    (async () => {
      try {
        const [number, note] = await Promise.all([
          getAppConfigValue("mpesa_manual_number"),
          getAppConfigValue("mpesa_manual_note"),
        ]);

        if (cancelled) return;

        setMpesaNumber(number || "07XXXXXXXX");
        setMpesaNote(note || "");
      } catch {
        if (cancelled) return;
        setMpesaNumber("07XXXXXXXX");
        setMpesaNote("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!depositId) return;

    const channel = supabase
      .channel(`deposit-status-${depositId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "deposits",
          filter: `id=eq.${depositId}`,
        },
        (payload) => {
          const newStatus = payload?.new?.status;

          if (newStatus === "approved") {
            setMessage({ type: "success", text: "Deposit approved! Wallet updated." });
            if (onApproved) onApproved();
            onClose();
          } else if (newStatus === "rejected") {
            setMessage({
              type: "error",
              text: payload?.new?.admin_note
                ? `Deposit rejected: ${payload.new.admin_note}`
                : "Deposit rejected by admin.",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [depositId, onApproved, onClose]);

  if (!isOpen) return null;

  async function handleCreateDeposit() {
    setMessage(null);

    if (!amountCents) {
      setMessage({ type: "error", text: "Enter a valid amount." });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("deposit_initiate", {
        p_amount_cents: amountCents,
        p_phone: mpesaNumber,
      });

      if (error) throw error;

      const id = typeof data === "string" ? data : data?.deposit_id || data?.id || data;
      if (!id) throw new Error("Deposit created but no deposit id returned.");

      setDepositId(id);
      setStatus("created");

      setMessage({
        type: "info",
        text: "Deposit created. Send money using the steps below, then paste the M-Pesa code.",
      });
    } catch (e) {
      setMessage({ type: "error", text: e?.message || "Failed to create deposit." });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitRef() {
    setMessage(null);

    const code = (mpesaRef || "").trim();
    if (code.length < 6) {
      setMessage({ type: "error", text: "Enter a valid M-Pesa reference code." });
      return;
    }
    if (!depositId) {
      setMessage({ type: "error", text: "Create a deposit first." });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc("deposit_submit_mpesa_ref", {
        p_deposit_id: depositId,
        p_mpesa_ref: code,
      });

      if (error) throw error;

    setStatus("submitted");
    if (onSubmitted) onSubmitted();
    onClose();
    } catch (e) {
      setMessage({ type: "error", text: e?.message || "Failed to submit reference code." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modalOverlay" style={{ position: "fixed", inset: 0, zIndex: 999999, overflowY: "auto" }}>
      <div
        className="modal"
        style={{
          maxHeight: "100vh",
          overflowY: "auto",
        }}
      >
        <div className="modalHeader">
          <h2>Deposit (Manual M-Pesa)</h2>
          <button onClick={onClose} className="iconBtn" aria-label="Close" type="button">
            ✕
          </button>
        </div>

        {message?.text ? <div className={`alert ${message.type}`}>{message.text}</div> : null}

        <div className="section">
          <label>Amount (KES)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
            inputMode="decimal"
            disabled={loading || status !== "idle"}
          />
          <button onClick={handleCreateDeposit} disabled={loading || status !== "idle"} type="button">
            {loading ? "Please wait..." : "Continue"}
          </button>
        </div>

        {status !== "idle" && (
          <div className="section">
            <h3>How to Send Money</h3>
            <ol style={{ textAlign: "left", paddingLeft: "1.5rem", marginBottom: "1rem" }}>
              <li>Open M-Pesa on your phone</li>
              <li>Select <b>Send Money</b></li>
              <li>Enter this number: <b style={{ color: "var(--accent-gold)", fontSize: "1.1em" }}>{mpesaNumber}</b></li>
              <li>Enter the amount: <b style={{ color: "var(--accent-gold)", fontSize: "1.1em" }}>KES {amount || "..."}</b></li>
              <li>Enter your M-Pesa PIN and confirm</li>
              <li>Wait for the confirmation SMS</li>
              <li>Copy the M-Pesa reference code from the SMS (e.g. QAZ1BCD234)</li>
              <li>Come back here and paste the code below</li>
            </ol>

            {mpesaNote ? <p className="muted" style={{ marginBottom: "1rem", padding: "0.75rem", backgroundColor: "var(--bg-secondary)", borderRadius: "4px" }}>{mpesaNote}</p> : null}

            <label>M-Pesa Reference Code</label>
            <input
              value={mpesaRef}
              onChange={(e) => setMpesaRef(e.target.value)}
              placeholder="Paste M-Pesa code here (e.g. QAZ1BCD234)"
              disabled={loading || status === "submitted"}
              autoCapitalize="characters"
              autoCorrect="off"
            />

            <button onClick={handleSubmitRef} disabled={loading || status === "submitted"} type="button">
              {loading ? "Submitting..." : status === "submitted" ? "Code Submitted" : "Submit Code"}
            </button>

        {status === "submitted" ? (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            Waiting for admin approval…
          </p>
        ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
