import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYHERO_API = "https://backend.payhero.co.ke/api/v2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "",
);

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function getPayheroAuthHeader() {
  const username = Deno.env.get("PAYHERO_USERNAME") ?? "";
  const password = Deno.env.get("PAYHERO_PASSWORD") ?? "";

  if (!username || !password) {
    throw new Error("PAYHERO_CONFIG_MISSING");
  }

  const token = btoa(`${username}:${password}`);
  return `Basic ${token}`;
}

function normalizePhone(rawPhone: string | null | undefined) {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `254${digits}`;

  return digits;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function mapPayheroStatus(rawStatus: unknown): "success" | "failed" | "processing" {
  const normalized = String(rawStatus ?? "").trim().toUpperCase();

  if (normalized === "SUCCESS" || normalized === "APPROVED") return "success";
  if (
    normalized === "QUEUED" ||
    normalized === "PENDING" ||
    normalized === "PROCESSING"
  ) {
    return "processing";
  }

  return "failed";
}

async function updateDepositStatus(depositId: string, fields: Record<string, unknown>) {
  const { error } = await supabase
    .from("deposits")
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId);

  if (error) {
    throw new Error(error.message);
  }
}

async function verifyPayheroReference(reference: string) {
  try {
    const res = await fetch(
      `${PAYHERO_API}/transaction-status?reference=${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: getPayheroAuthHeader(),
        },
      },
    );

    const rawText = await res.text();
    let data: Record<string, unknown> = {};

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw_response: rawText };
    }

    if (!res.ok) {
      console.log("PayHero verify status:", res.status);
      console.log("PayHero verify raw response:", rawText);
      return null;
    }

    return data;
  } catch (error) {
    console.error("PayHero verify fetch failed:", error);
    return null;
  }
}

async function findDepositForWebhook(
  externalReference: string | null,
  providerReference: string | null,
) {
  if (externalReference) {
    const { data } = await supabase
      .from("deposits")
      .select("id, external_ref, checkout_request_id")
      .eq("external_ref", externalReference)
      .maybeSingle();

    if (data?.id) return data;
  }

  if (providerReference) {
    const { data } = await supabase
      .from("deposits")
      .select("id, external_ref, checkout_request_id")
      .eq("checkout_request_id", providerReference)
      .maybeSingle();

    if (data?.id) return data;
  }

  return null;
}

async function broadcastDepositUpdate(depositId: string, payload: Record<string, unknown>) {
  const channel = supabase.channel("deposit-updates");

  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });

  await channel.send({
    type: "broadcast",
    event: "deposit_update",
    payload: {
      deposit_id: depositId,
      ...payload,
    },
  });

  await supabase.removeChannel(channel);
}

async function logIncomingRequest(tag: string, req: Request, parsedBody?: unknown) {
  const url = new URL(req.url);

  const headers: Record<string, string> = {};
  for (const [key, value] of req.headers.entries()) {
    headers[key] = value;
  }

  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }

  console.log(`${tag} request info:`, JSON.stringify({
    method: req.method,
    pathname: url.pathname,
    query,
    headers,
    body: parsedBody ?? null,
  }));
}

async function handleInitiate(req: Request): Promise<Response> {
  type InitiateBody = {
    deposit_id?: string;
    amount_cents?: number | string;
    phone?: string | null;
  };

  let body: InitiateBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "INVALID_JSON", message: "Request body must be valid JSON." },
      400,
    );
  }

  const depositId = String(body.deposit_id ?? "").trim();
  const amountCents = Number(body.amount_cents ?? 0);
  const normalizedPhone = normalizePhone(body.phone);

  if (!depositId) {
    return jsonResponse(
      { error: "INVALID_INPUT", message: "deposit_id is required." },
      400,
    );
  }

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return jsonResponse(
      { error: "INVALID_INPUT", message: "amount_cents must be a positive number." },
      400,
    );
  }

  if (!normalizedPhone || normalizedPhone.length !== 12 || !normalizedPhone.startsWith("254")) {
    return jsonResponse(
      {
        error: "INVALID_PHONE",
        message: "Enter a valid Kenyan phone number.",
        phone_received: body.phone ?? null,
        phone_normalized: normalizedPhone,
      },
      400,
    );
  }

  const channelIdRaw = Deno.env.get("PAYHERO_CHANNEL_ID") ?? "";
  const callbackUrl = Deno.env.get("PAYHERO_CALLBACK_URL") ?? "";

  if (!channelIdRaw || !callbackUrl) {
    return jsonResponse(
      {
        error: "CONFIG_MISSING",
        message: "PayHero channel/callback config missing.",
        has_channel_id: Boolean(channelIdRaw),
        has_callback_url: Boolean(callbackUrl),
      },
      500,
    );
  }

  const channelId = Number(channelIdRaw);
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return jsonResponse(
      {
        error: "INVALID_CONFIG",
        message: "PAYHERO_CHANNEL_ID must be a valid number.",
        channel_id_received: channelIdRaw,
      },
      500,
    );
  }

  let authHeader = "";
  try {
    authHeader = getPayheroAuthHeader();
  } catch (error) {
    return jsonResponse(
      {
        error: "CONFIG_MISSING",
        message: error instanceof Error ? error.message : "PayHero credentials missing.",
      },
      500,
    );
  }

  const { data: deposit, error: depositError } = await supabase
    .from("deposits")
    .select("id, amount_cents, status, external_ref")
    .eq("id", depositId)
    .maybeSingle();

  if (depositError) {
    console.error("Deposit lookup failed:", depositError);
    return jsonResponse(
      { error: "DEPOSIT_LOOKUP_FAILED", message: depositError.message },
      500,
    );
  }

  if (!deposit?.id) {
    return jsonResponse(
      {
        error: "DEPOSIT_NOT_FOUND",
        message: "Deposit record not found.",
        deposit_id: depositId,
      },
      404,
    );
  }

  const dbAmountCents = Number(deposit.amount_cents ?? 0);
  if (dbAmountCents !== amountCents) {
    return jsonResponse(
      {
        error: "AMOUNT_MISMATCH",
        message: "Requested amount does not match deposit record.",
        request_amount_cents: amountCents,
        db_amount_cents: dbAmountCents,
      },
      400,
    );
  }

  const currentStatus = String(deposit.status ?? "").trim().toLowerCase();
  if (["approved", "success", "completed"].includes(currentStatus)) {
    return jsonResponse(
      {
        error: "ALREADY_APPROVED",
        message: "This deposit has already been completed.",
        status: deposit.status,
      },
      400,
    );
  }

  if (amountCents % 100 !== 0) {
    return jsonResponse(
      {
        error: "INVALID_AMOUNT",
        message: "Amount must be in whole KES only.",
        amount_cents: amountCents,
      },
      400,
    );
  }

  const externalReference = String(deposit.external_ref ?? "").trim() || `dep_${depositId}`;
  const amountKes = amountCents / 100;

  try {
    await updateDepositStatus(depositId, {
      status: "processing",
      provider: "payhero",
      phone: normalizedPhone,
      external_ref: externalReference,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "DB_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Failed to update deposit before initiation.",
      },
      500,
    );
  }

  const payload = {
    amount: amountKes,
    phone_number: normalizedPhone,
    channel_id: channelId,
    provider: "m-pesa",
    external_reference: externalReference,
    callback_url: callbackUrl,
  };

  console.log("PayHero initiate payload:", JSON.stringify(payload));

  let res: Response;
  let rawPayheroText = "";
  let payheroData: Record<string, unknown> = {};

  try {
    res = await fetch(`${PAYHERO_API}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    rawPayheroText = await res.text();
    console.log("PayHero initiate status:", res.status);
    console.log("PayHero initiate raw response:", rawPayheroText);

    try {
      payheroData = rawPayheroText ? JSON.parse(rawPayheroText) : {};
    } catch {
      payheroData = { raw_response: rawPayheroText };
    }
  } catch (error) {
    console.error("PayHero fetch failed:", error);

    await updateDepositStatus(depositId, {
      status: "failed",
      failure_reason: error instanceof Error ? error.message : "PayHero fetch failed",
    }).catch(() => null);

    return jsonResponse(
      {
        error: "PAYMENT_INIT_FAILED",
        message: error instanceof Error ? error.message : "Failed to reach PayHero.",
        debug_version: "payments-debug-v3",
        diagnostic: {
          stage: "fetch",
          request_payload: payload,
        },
      },
      400,
    );
  }

  if (!res.ok) {
    const payheroMessage =
      firstString(
        (payheroData as Record<string, unknown>).message,
        (payheroData as Record<string, unknown>).error,
        (payheroData as Record<string, unknown>).detail,
        (payheroData as Record<string, unknown>).response_message,
        (payheroData as Record<string, unknown>).status_description,
        (payheroData as Record<string, unknown>).error_message,
      ) || "PayHero initiation failed.";

    await updateDepositStatus(depositId, {
      status: "failed",
      failure_reason: payheroMessage,
    }).catch(() => null);

    return jsonResponse(
      {
        error: "PAYMENT_INIT_FAILED",
        message: payheroMessage,
        debug_version: "payments-debug-v3",
        diagnostic: {
          stage: "payhero_rejected",
          payhero_status: res.status,
          payhero_response: payheroData,
          request_payload: payload,
        },
      },
      400,
    );
  }

  const providerReference = firstString(
    (payheroData as Record<string, unknown>).reference,
    (payheroData as Record<string, unknown>).checkout_request_id,
    (payheroData as Record<string, unknown>).CheckoutRequestID,
    (payheroData as Record<string, unknown>).transaction_reference,
    (payheroData as Record<string, unknown>).id,
  );

  const merchantReference = firstString(
    (payheroData as Record<string, unknown>).merchant_request_id,
    (payheroData as Record<string, unknown>).MerchantRequestID,
    (payheroData as Record<string, unknown>).request_id,
  );

  try {
    await updateDepositStatus(depositId, {
      status: "processing",
      provider: "payhero",
      phone: normalizedPhone,
      external_ref: externalReference,
      checkout_request_id: providerReference,
      merchant_request_id: merchantReference,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "DB_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Failed to save PayHero references.",
        diagnostic: {
          payhero_response: payheroData,
          request_payload: payload,
        },
      },
      500,
    );
  }

  return jsonResponse({
    success: true,
    deposit_id: depositId,
    status: "processing",
    reference: providerReference,
    external_reference: externalReference,
    merchant_request_id: merchantReference,
    payhero_response: payheroData,
    message: "STK prompt sent. Check phone to complete payment.",
  });
}

async function handleWebhook(req: Request): Promise<Response> {
  const ok = () => new Response(null, { status: 200, headers: corsHeaders });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return ok();
  }

  await logIncomingRequest("PayHero webhook", req, body);

  console.log("PayHero webhook body:", JSON.stringify(body));

  const payload =
    body.response && typeof body.response === "object"
      ? (body.response as Record<string, unknown>)
      : body;

  const providerReference = firstString(
    payload.reference,
    payload.checkout_request_id,
    payload.CheckoutRequestID,
    payload.transaction_reference,
    payload.id,
  );

  const externalReference = firstString(
    payload.external_reference,
    payload.ExternalReference,
    payload.externalRef,
    payload.tx_ref,
    payload.account_reference,
  );

  const merchantReference = firstString(
    payload.merchant_request_id,
    payload.MerchantRequestID,
    payload.mpesa_receipt_number,
    payload.MpesaReceiptNumber,
    payload.mpesa_code,
  );

  const deposit = await findDepositForWebhook(externalReference, providerReference);

  if (!deposit?.id) {
    console.log("PayHero webhook: deposit not found", {
      externalReference,
      providerReference,
      merchantReference,
      payload,
    });
    return ok();
  }

  const statusText = String(payload.Status ?? payload.status ?? "").trim().toUpperCase();
  const resultCode = String(payload.ResultCode ?? payload.result_code ?? "").trim();

  let finalStatus: "success" | "failed" | "processing" = "processing";

  if (statusText === "SUCCESS" || resultCode === "0") {
    finalStatus = "success";
  } else if (statusText === "FAILED") {
    finalStatus = "failed";
  } else {
    finalStatus = mapPayheroStatus(
      payload.Status ?? payload.status ?? payload.ResultCode ?? payload.result_code,
    );
  }

  console.log("PayHero webhook resolved refs:", {
    externalReference,
    providerReference,
    merchantReference,
    statusText,
    resultCode,
    finalStatus,
  });

  if (providerReference && finalStatus === "processing") {
    const verifyData = await verifyPayheroReference(providerReference);
    const verifiedRawStatus =
      (verifyData as Record<string, unknown> | null)?.status ??
      (verifyData as Record<string, unknown> | null)?.payment_status;

    const verifiedStatus = verifyData ? mapPayheroStatus(verifiedRawStatus) : null;

    if (verifiedStatus) {
      finalStatus = verifiedStatus;
    }

    console.log("PayHero verify result:", {
      providerReference,
      verifyData,
      finalStatus,
    });
  }

  const { data: callbackData, error: callbackError } = await supabase.rpc("deposit_apply_callback", {
    p_deposit_id: deposit.id,
    p_status: finalStatus === "success" ? "success" : "failed",
    p_checkout_request_id: providerReference,
    p_merchant_request_id: merchantReference,
    p_external_ref: deposit.external_ref ?? externalReference,
  });

  console.log("deposit_apply_callback result:", {
    deposit_id: deposit.id,
    finalStatus,
    callbackData,
    callbackError,
  });

  if (callbackError) {
    console.error("deposit_apply_callback failed:", callbackError);
  }

        await broadcastDepositUpdate(deposit.id, {
      status: finalStatus,
      message:
        finalStatus === "success"
          ? "Deposit confirmed. Wallet updated successfully."
          : String(payload.ResultDesc ?? payload.result_description ?? "Payment failed."),
      checkout_request_id: providerReference,
      merchant_request_id: merchantReference,
    });

  return ok();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (path.endsWith("/webhook") || path.includes("/payments/webhook")) {
    if (req.method === "POST") {
      return handleWebhook(req);
    }

    if (req.method === "GET") {
      await logIncomingRequest("PayHero webhook GET", req, null);
      return jsonResponse({
        success: true,
        message: "Webhook GET received",
      });
    }
  }

  if (req.method === "POST") {
    return handleInitiate(req);
  }

  return jsonResponse({ error: "NOT_FOUND" }, 404);
});
