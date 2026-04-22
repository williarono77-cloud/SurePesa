import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient.js";

const INITIAL_STATUS_DELAY_MS = 6000;
const RETRY_DELAY_MS = 3000;
const MAX_STATUS_ATTEMPTS = 3;

export default function DepositModal({ isOpen, onClose, onSubmitted, onApproved }) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("07XXXXXXXX");
  const [depositId, setDepositId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | initiating | pending | success | failed
  const [message, setMessage] = useState(null);

  const closeTimerRef = useRef(null);
  const statusTimerRef = useRef(null);
  const statusAttemptsRef = useRef(0);
  const pollingStoppedRef = useRef(false);

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

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function clearStatusTimer() {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }

  function clearAllTimers() {
    clearCloseTimer();
    clearStatusTimer();
  }

  function stopPolling() {
    pollingStoppedRef.current = true;
    clearStatusTimer();
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 1200);
  }

  function handleSuccess(nextMessage, payload = null, source = "unknown") {
    stopPolling();
    setLoading(false);
    setStatus("success");
    setMessage({
      type: "success",
      text: nextMessage || "Deposit confirmed. Wallet updated successfully.",
    });

    if (onApproved) {
      onApproved({
        ...(payload || {}),
        id: payload?.id || depositId,
        status: "success",
        message: nextMessage || "Deposit confirmed. Wallet updated successfully.",
        source,
      });
    }

    scheduleClose();
  }

  function handleFailure(nextMessage, payload = null) {
    stopPolling();
    setLoading(false);
    setStatus("failed");
    setMessage({
      type: "error",
      text: nextMessage || "Payment failed. Please try again.",
    });
  }

  function handlePending(nextMessage) {
    setLoading(false);
    setStatus("pending");
    setMessage({
      type: "info",
      text: nextMessage || "Payment request sent. Check your phone and complete the prompt.",
    });
  }

  async function checkDepositStatus(targetDepositId) {
    if (!targetDepositId || pollingStoppedRef.current) return;

    try {
      const { data, error } = await supabase.functions.invoke("payments/status", {
        body: { deposit_id: targetDepositId },
      });

      if (error) {
        throw error;
      }

      const nextStatus = String(data?.status || "").trim().toLowerCase();
      const nextMessage =
        data?.message ||
        (nextStatus === "success"
          ? "Deposit confirmed. Wallet updated successfully."
          : nextStatus === "failed"
          ? "Payment failed. Please try again."
          : "Payment is still pending.");

      if (nextStatus === "success" || nextStatus === "approved" || nextStatus === "completed") {
        handleSuccess(nextMessage, data, "manual_status_check");
        return;
      }

      if (nextStatus === "failed" || nextStatus === "rejected") {
        handleFailure(nextMessage, data);
        return;
      }

      handlePending(nextMessage);

      if (statusAttemptsRef.current >= MAX_STATUS_ATTEMPTS) {
        stopPolling();
        setMessage({
          type: "info",
          text: nextMessage || "Payment is still pending. Please wait a moment and try again if needed.",
        });
        return;
      }

      statusTimerRef.current = setTimeout(() => {
        checkDepositStatus(targetDepositId);
      }, RETRY_DELAY_MS);
    } catch (e) {
      console.error("Deposit status check failed:", e);

      if (statusAttemptsRef.current >= MAX_STATUS_ATTEMPTS) {
        stopPolling();
        setLoading(false);
        setMessage({
          type: "error",
          text: e?.message || "Failed to confirm payment status. Please try again.",
        });
        return;
      }

      statusTimerRef.current = setTimeout(() => {
        checkDepositStatus(targetDepositId);
      }, RETRY_DELAY_MS);
    }
  }

  function startStatusPolling(targetDepositId) {
    if (!targetDepositId) return;

    stopPolling();
    pollingStoppedRef.current = false;
    statusAttemptsRef.current = 0;

    clearStatusTimer();
    statusTimerRef.current = setTimeout(() => {
      checkDepositStatus(targetDepositId);
    }, INITIAL_STATUS_DELAY_MS);
  }

  useEffect(() => {
    if (!isOpen) return;

    clearAllTimers();
    pollingStoppedRef.current = false;
    statusAttemptsRef.current = 0;

    setLoading(false);
    setAmount("");
    setPhone("07XXXXXXXX");
    setDepositId(null);
    setStatus("idle");
    setMessage(null);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopPolling();
      clearAllTimers();
    };
  }, []);

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
          const row = payload?.new || {};
          const newStatus = String(row.status || "").trim().toLowerCase();
          const failureText =
            row.failure_reason ||
            row.admin_note ||
            row.note ||
            "Payment failed. Please try again.";

          if (newStatus === "success" || newStatus === "approved" || newStatus === "completed") {
            handleSuccess("Deposit confirmed. Wallet updated successfully.", row, "realtime_update");
            return;
          }

          if (newStatus === "processing" || newStatus === "pending") {
            handlePending("Payment request sent. Check your phone and complete the prompt.");
            return;
          }

          if (newStatus === "failed" || newStatus === "rejected") {
            handleFailure(failureText, row);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [depositId, onApproved, onClose]);

  useEffect(() => {
    if (!depositId) return;

    const channel = supabase
      .channel(`deposit-broadcast-${depositId}`)
      .on("broadcast", { event: "deposit_update" }, ({ payload }) => {
        if (!payload || payload.deposit_id !== depositId) return;

        const newStatus = String(payload.status || "").trim().toLowerCase();
        const text =
          payload.message ||
          (newStatus === "success"
            ? "Deposit confirmed. Wallet updated successfully."
            : newStatus === "failed"
            ? "Payment failed. Please try again."
            : "Payment request sent. Check your phone and complete the prompt.");

        if (newStatus === "success" || newStatus === "approved" || newStatus === "completed") {
          handleSuccess(text, payload, "broadcast_update");
          return;
        }

        if (newStatus === "failed" || newStatus === "rejected") {
          handleFailure(text, payload);
          return;
        }

        if (newStatus === "processing" || newStatus === "pending") {
          handlePending(text);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [depositId, onApproved, onClose]);

  useEffect(() => {
    if (!isOpen || !depositId || status !== "pending") {
      stopPolling();
      return;
    }

    startStatusPolling(depositId);

    return () => {
      stopPolling();
    };
  }, [isOpen, depositId, status]);

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
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message || "Failed to check session.");
      }

      const accessToken = sessionData?.session?.access_token;
      const userId = sessionData?.session?.user?.id;

      console.log("Deposit session check:", {
        hasSession: Boolean(sessionData?.session),
        hasAccessToken: Boolean(accessToken),
        userId: userId || null,
      });

      if (!accessToken || !userId) {
        throw new Error("Please sign in before making a deposit.");
      }

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
          deposit_id: createdDepositId,
          amount_cents: amountCents,
          phone: normalizedPhone,
        },
      });

      if (paymentError) throw paymentError;

      if (!paymentData?.success) {
        throw new Error(paymentData?.message || "Failed to start payment.");
      }

      setStatus("pending");
      setMessage({
        type: "info",
        text:
          paymentData?.message ||
          "Payment request sent. Check your phone and complete the prompt.",
      });

      if (onSubmitted) {
        onSubmitted({
          depositId: createdDepositId,
          status: "processing",
          message:
            paymentData?.message ||
            "Payment request sent. Check your phone and complete the prompt.",
        });
      }
    } catch (e) {
      stopPolling();
      setStatus("failed");
      setLoading(false);
      setMessage({
        type: "error",
        text: e?.message || "Failed to start payment.",
      });
      return;
    } finally {
      setLoading(false);
    }
  }

  const disableInputs = loading || status === "pending" || status === "success";

  if (!isOpen) return null;

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
            disabled={disableInputs}
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
            disabled={disableInputs}
          />
        </div>

        <div className="section">
          <button onClick={handleStartDeposit} disabled={disableInputs} type="button">
            {loading
              ? "Please wait..."
              : status === "pending"
              ? "Payment Pending"
              : status === "success"
              ? "Deposit Complete"
              : "Pay Now"}
          </button>

          {status === "pending" ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Complete the payment prompt on your phone. Your wallet will update automatically once payment is confirmed.
            </p>
          ) : null}

          {status === "success" ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Payment confirmed successfully. Closing…
            </p>
          ) : null}

          {status === "failed" ? (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Payment did not complete. You can try again.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
