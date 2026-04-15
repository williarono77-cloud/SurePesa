import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";

export default function DepositModal({ isOpen, onClose, onSubmitted, onApproved }) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("07XXXXXXXX");
  const [depositId, setDepositId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | initiating | pending | approved | failed
  const [message, setMessage] = useState(null);

  const amountCents = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }, [amount]);

  function normalizePhone(rawPhone) {
    const digits = String(rawPhone || "").replace(/\D/g, "");

    if (!digits) return "";
    if (digits.startsWith("254") && digits.length === 12) return digits;
    if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
    if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;
    if (digits.startsWith("1") && digits.length === 9) return `254${digits}`;

    return digits;
  }

  useEffect(() => {
    if (!isOpen) return;

    setLoading(false);
    setAmount("");
    setPhone("07XXXXXXXX");
    setDepositId(null);
    setStatus("idle");
    setMessage(null);
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
            setStatus("approved");
            setLoading(false);
            setMessage({
              type: "success",
              text: "Deposit confirmed. Wallet updated successfully.",
            });

            if (onApproved) onApproved();
            return;
          }

          if (newStatus === "processing" || newStatus === "pending") {
            setStatus("pending");
            setLoading(false);
            setMessage({
              type: "info",
              text: "Payment request sent. Check your phone and complete the prompt.",
            });
            return;
          }

          if (newStatus === "failed" || newStatus === "rejected") {
            setStatus("failed");
            setLoading(false);
            setMessage({
              type: "error",
              text:
                payload?.new?.admin_note ||
                payload?.new?.failure_reason ||
                "Payment failed. Please try again.",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [depositId, onApproved]);

  if (!isOpen) return null;

  async function handleStartDeposit() {
    setMessage(null);

    if (!amountCents) {
      setMessage({ type: "error", text: "Enter a valid amount." });
      return;
    }

    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || normalizedPhone.length !== 12 || !normalizedPhone.startsWith("254")) {
      setMessage({
        type: "error",
        text: "Enter a valid Safaricom phone number.",
      });
      return;
    }

    setLoading(true);
    setStatus("initiating");

    try {
      const { data: depositData, error: depositError } = await supabase.rpc("deposit_initiate", {
        p_amount_cents: amountCents,
        p_phone: normalizedPhone,
      });

      if (depositError) throw depositError;

      const createdDepositId =
        typeof depositData === "string"
          ? depositData
          : depositData?.deposit_id || depositData?.id || depositData;

      if (!createdDepositId) {
        throw new Error("Deposit created but no deposit id returned.");
      }

      setDepositId(createdDepositId);

      const { data: paymentData, error: paymentError } = await supabase.functions.invoke("payments", {
        body: {
          action: "initiate",
          deposit_id: createdDepositId,
          amount_cents: amountCents,
          phone: normalizedPhone,
        },
      });

      if (paymentError) throw paymentError;

      if (paymentData?.ok === false) {
        throw new Error(paymentData?.error || "Failed to start payment.");
      }

      setStatus("pending");
      setMessage({
        type: "info",
        text: "Payment request sent. Check your phone and complete the prompt.",
      });

      if (onSubmitted) onSubmitted();
    } catch (e) {
      setStatus("failed");
      setMessage({
        type: "error",
        text: e?.message || "Failed to start payment.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      style={{ position: "fixed", inset: 0, zIndex: 999999, overflowY: "auto" }}
    >
      <div
        className="modal"
        style={{
          maxHeight: "100vh",
          overflowY: "auto",
        }}
      >
        <div className="modalHeader">
          <h2>Deposit</h2>
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
            disabled={loading || status === "pending" || status === "approved"}
          />
        </div>

        <div className="section">
          <label>Phone Number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 07XXXXXXXX or 2547XXXXXXXX"
            inputMode="tel"
            autoComplete="tel"
            disabled={loading || status === "pending" || status === "approved"}
          />
        </div>

        <div className="section">
          <button
            onClick={handleStartDeposit}
            disabled={loading || status === "pending" || status === "approved"}
            type="button"
          >
            {loading
              ? "Please wait..."
              : status === "pending"
              ? "Payment Pending"
              : status === "approved"
              ? "Deposit Complete"
              : "Pay Now"}
          </button>

          {status === "pending" ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Complete the payment prompt on your phone. Your wallet will update automatically once payment is confirmed.
            </p>
          ) : null}

          {status === "approved" ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Payment confirmed successfully.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
