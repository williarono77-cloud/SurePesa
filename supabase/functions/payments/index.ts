import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FLW_API = "https://api.flutterwave.com/v3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody)
  );
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const expected = btoa(binary);
  return expected === signature;
}

async function handleInitiate(req: Request): Promise<Response> {
  let body: { deposit_id?: string; amount_cents?: number; email?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400);
  }

  const depositId = body.deposit_id;
  const amountCents = body.amount_cents;
  const email = body.email;
  const phone = body.phone;

  if (!depositId || amountCents == null || amountCents <= 0) {
    return jsonResponse(
      { error: "INVALID_INPUT", message: "deposit_id and amount_cents required; amount_cents > 0" },
      400
    );
  }

  const amountKes = amountCents / 100;
  if (amountKes <= 0) {
    return jsonResponse({ error: "INVALID_AMOUNT", message: "Amount too small" }, 400);
  }

  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!secretKey || !supabaseUrl) {
    return jsonResponse({ error: "CONFIG_MISSING" }, 500);
  }

  let customerEmail = email?.trim();
  if (!customerEmail) {
    const { data: deposit } = await supabase
      .from("deposits")
      .select("user_id")
      .eq("id", depositId)
      .single();
    if (!deposit?.user_id) {
      return jsonResponse({ error: "DEPOSIT_NOT_FOUND", message: "Deposit not found" }, 404);
    }
    const { data: { user } } = await supabase.auth.admin.getUserById(deposit.user_id);
    customerEmail = user?.email ?? null;
    if (!customerEmail) {
      return jsonResponse({ error: "EMAIL_REQUIRED", message: "Customer email required for Flutterwave" }, 400);
    }
  }

  const txRef = `dep_${depositId}`;
  const origin = req.headers.get("Origin") ?? req.headers.get("Referer");
  const redirectUrl = origin
    ? origin.replace(/\/$/, "") + "/"
    : `${supabaseUrl.replace(/\/$/, "")}/`;

  const payload = {
    tx_ref: txRef,
    amount: amountKes,
    currency: "KES",
    redirect_url: redirectUrl,
    payment_options: "card,mobilemoney",
    customer: {
      email: customerEmail,
      name: customerEmail.split("@")[0] ?? "Customer",
      phonenumber: phone?.replace(/\s/g, "") ?? "",
    },
    customizations: {
      title: "Deposit",
      description: "Wallet deposit",
    },
  };

  const res = await fetch(`${FLW_API}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.status !== "success") {
    return jsonResponse(
      {
        error: "PAYMENT_INIT_FAILED",
        message: data.message ?? data.error ?? "Failed to create payment",
      },
      400
    );
  }

  const paymentLink = data.data?.link ?? null;
  if (!paymentLink) {
    return jsonResponse({ error: "NO_PAYMENT_LINK", message: "No payment link returned" }, 502);
  }

  const { error: updateErr } = await supabase
    .from("deposits")
    .update({
      provider: "flutterwave",
      external_ref: txRef,
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId);

  if (updateErr) {
    return jsonResponse({ error: "DB_UPDATE_FAILED", message: updateErr.message }, 500);
  }

  return jsonResponse({
    success: true,
    deposit_id: depositId,
    payment_link: paymentLink,
    tx_ref: txRef,
  });
}

async function handleWebhook(req: Request): Promise<Response> {
  const webhookSecret = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");
  const rawBody = await req.text();
  const verifHash = req.headers.get("verif-hash");
  const flutterwaveSig = req.headers.get("flutterwave-signature");

  const ok = () => new Response(null, { status: 200 });

  if (!webhookSecret) {
    return ok();
  }

  let verified = false;
  if (verifHash) {
    if (verifHash === webhookSecret) {
      verified = true;
    }
  } else if (flutterwaveSig) {
    verified = await verifyWebhookSignature(rawBody, flutterwaveSig, webhookSecret);
  }

  if (!verified) {
    return ok();
  }

  let body: {
    data?: {
      tx_ref?: string;
      reference?: string;
      id?: string;
      status?: string;
      flw_ref?: string;
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return ok();
  }

  const data = body.data ?? {};
  const txRef = (data.tx_ref ?? data.reference ?? "").trim();
  const flwRef = data.id ?? data.flw_ref ?? "";

  if (!txRef) {
    return ok();
  }

  const { data: deposit, error: lookupErr } = await supabase
    .from("deposits")
    .select("id, amount_cents")
    .eq("external_ref", txRef)
    .maybeSingle();

  if (lookupErr || !deposit?.id) {
    return ok();
  }

  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secretKey) {
    return ok();
  }

  const verifyRes = await fetch(
    `${FLW_API}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    }
  );

  const verifyData = await verifyRes.json().catch(() => ({}));

  let callbackStatus: "success" | "failed" = "failed";
  let externalRef: string | null = flwRef;

  if (verifyRes.ok && verifyData.status === "success") {
    const v = verifyData.data ?? {};
    const vTxRef = (v.tx_ref ?? v.reference ?? "").trim();
    const vStatus = (v.status ?? "").toLowerCase();
    const vAmount = Number(v.charged_amount ?? v.amount ?? 0);
    const vCurrency = (v.currency ?? "").toUpperCase();
    const expectedKes = deposit.amount_cents / 100;

    const amountMatch = Math.abs(vAmount - expectedKes) < 0.01;
    if (
      vTxRef === txRef &&
      (vStatus === "successful" || vStatus === "succeeded") &&
      vCurrency === "KES" &&
      amountMatch
    ) {
      callbackStatus = "success";
      externalRef = v.id ?? v.flw_ref ?? flwRef ?? null;
    }
  }

  await supabase.rpc("deposit_apply_callback", {
    p_deposit_id: deposit.id,
    p_status: callbackStatus,
    p_checkout_request_id: txRef,
    p_merchant_request_id: flwRef,
    p_external_ref: externalRef,
  });

  return ok();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "POST" && (path.endsWith("/initiate") || path.includes("/payments/initiate"))) {
    return handleInitiate(req);
  }

  if (req.method === "POST" && (path.endsWith("/webhook") || path.includes("/payments/webhook"))) {
    return handleWebhook(req);
  }

  return jsonResponse({ error: "NOT_FOUND" }, 404);
});
