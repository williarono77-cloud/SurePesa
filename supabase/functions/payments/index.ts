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
  if (normalized === "QUEUED" || normalized === "PENDING" || normalized === "PROCESSING") return "processing";
  return "failed";
}

async function updateDepositStatus(
  depositId: string,
  fields: Record<string, unknown>,
) {
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

async function handleInitiate(req: Request): Promise<Response> {
  let body: { deposit_id?: string; amount_cents?: number; phone?: string; action?: string };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400);
  }

  const depositId = String(body.deposit_id ?? "").trim();
  const amountCents = Number(body.amount_cents ?? 0);
  const normalizedPhone = normalizePhone(body.phone);

  if (!depositId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return jsonResponse(
      { error: "INVALID_INPUT", message: "deposit_id and amount_cents are required." },
      400,
    );
  }

  if (!normalizedPhone || normalizedPhone.length !== 12 || !normalizedPhone.startsWith("254")) {
    return jsonResponse(
      { error: "INVALID_PHONE", message: "Enter a valid Kenyan phone number." },
      400,
    );
  }

  const channelId = Deno.env.get("PAYHERO_CHANNEL_ID") ?? "";
  const callbackUrl = Deno.env.get("PAYHERO_CALLBACK_URL") ?? "";

  if (!channelId || !callbackUrl) {
    return jsonResponse({ error: "CONFIG_MISSING", message: "PayHero channel/callback config missing." }, 500);
  }

  const { data: deposit, error: depositError } = await supabase
    .from("deposits")
    .select("id, amount_cents, status, external_ref")
    .eq("id", depositId)
    .maybeSingle();

  if (depositError) {
    return jsonResponse({ error: "DEPOSIT_LOOKUP_FAILED", message: depositError.message }, 500);
  }

  if (!deposit?.id) {
    return jsonResponse({ error: "DEPOSIT_NOT_FOUND" }, 404);
  }

  if (Number(deposit.amount_cents ?? 0) !== amountCents) {
    return jsonResponse({ error: "AMOUNT_MISMATCH" }, 400);
  }

  if (String(deposit.status ?? "").toLowerCase() === "approved") {
    return jsonResponse({ error: "ALREADY_APPROVED" }, 400);
  }

  const externalReference = deposit.external_ref?.trim() || `dep_${depositId}`;
  const amountKes = Math.round(amountCents / 100);

  try {
    await updateDepositStatus(depositId, {
      status: "processing",
      provider: "payhero",
      phone: normalizedPhone,
      external_ref: externalReference,
    });
  } catch (error) {
    return jsonResponse(
      { error: "DB_UPDATE_FAILED", message: error instanceof Error ? error.message : "Failed to update deposit." },
      500,
    );
  }

  const payload = {
    amount: amountKes,
    phone_number: normalizedPhone,
    channel_id: Number(channelId),
    provider: "m-pesa",
    external_reference: externalReference,
    callback_url: callbackUrl,
  };

  let payheroData: Record<string, unknown> = {};

  try {
    const res = await fetch(`${PAYHERO_API}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getPayheroAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    payheroData = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        String(
          (payheroData as { message?: string; error?: string }).message ||
            (payheroData as { message?: string; error?: string }).error ||
            "PayHero initiation failed.",
        ),
      );
    }
  } catch (error) {
    await updateDepositStatus(depositId, { status: "failed" }).catch(() => null);

    return jsonResponse(
      {
        error: "PAYMENT_INIT_FAILED",
        message: error instanceof Error ? error.message : "Failed to initiate PayHero payment.",
      },
      400,
    );
  }

  const providerReference = firstString(
    payheroData.reference,
    payheroData.checkout_request_id,
    payheroData.CheckoutRequestID,
    payheroData.transaction_reference,
    payheroData.id,
  );

  const merchantReference = firstString(
    payheroData.merchant_request_id,
    payheroData.MerchantRequestID,
    payheroData.request_id,
  );

  try {
    await updateDepositStatus(depositId, {
      status: "processing",
      provider: "payhero",
      external_ref: externalReference,
      checkout_request_id: providerReference,
      merchant_request_id: merchantReference,
    });
  } catch (error) {
    return jsonResponse(
      { error: "DB_UPDATE_FAILED", message: error instanceof Error ? error.message : "Failed to save payment refs." },
      500,
    );
  }

  return jsonResponse({
    success: true,
    deposit_id: depositId,
    status: "processing",
    reference: providerReference,
    external_reference: externalReference,
    message: "STK prompt sent. Check phone to complete payment.",
  });
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

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

async function findDepositForWebhook(externalReference: string | null, providerReference: string | null) {
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

async function handleWebhook(req: Request): Promise<Response> {
  const ok = () => new Response(null, { status: 200, headers: corsHeaders });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return ok();
  }

  const providerReference = firstString(
    body.reference,
    body.checkout_request_id,
    body.CheckoutRequestID,
    body.transaction_reference,
    body.id,
  );

  const externalReference = firstString(
    body.external_reference,
    body.externalRef,
    body.tx_ref,
    body.account_reference,
  );

  const merchantReference = firstString(
    body.merchant_request_id,
    body.MerchantRequestID,
    body.mpesa_receipt_number,
    body.mpesa_code,
  );

  const callbackRawStatus = firstString(body.status, body.result_code, body.state);
  const deposit = await findDepositForWebhook(externalReference, providerReference);

  if (!deposit?.id) {
    return ok();
  }

  let finalStatus = mapPayheroStatus(callbackRawStatus);

  if (providerReference) {
    const verifyData = await verifyPayheroReference(providerReference);
    const verifiedStatus = verifyData
      ? mapPayheroStatus(
          (verifyData as Record<string, unknown>).status ??
            (verifyData as Record<string, unknown>).payment_status,
        )
      : null;

    if (verifiedStatus) {
      finalStatus = verifiedStatus;
    }
  }

  if (finalStatus === "processing") {
    await updateDepositStatus(deposit.id, {
      status: "processing",
      checkout_request_id: providerReference ?? deposit.checkout_request_id,
      merchant_request_id: merchantReference,
      external_ref: deposit.external_ref ?? externalReference,
    }).catch(() => null);

    return ok();
  }

  await supabase.rpc("deposit_apply_callback", {
    p_deposit_id: deposit.id,
    p_status: finalStatus === "success" ? "success" : "failed",
    p_checkout_request_id: providerReference,
    p_merchant_request_id: merchantReference,
    p_external_ref: deposit.external_ref ?? externalReference,
  });

  return ok();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "POST" && (path.endsWith("/webhook") || path.includes("/payments/webhook"))) {
    return handleWebhook(req);
  }

  if (req.method === "POST") {
    return handleInitiate(req);
  }

  return jsonResponse({ error: "NOT_FOUND" }, 404);
});
