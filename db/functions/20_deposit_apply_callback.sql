-- Callback: apply deposit result (service role / Edge Function only); idempotent
CREATE OR REPLACE FUNCTION public.deposit_apply_callback(
  p_deposit_id UUID,
  p_status TEXT,
  p_checkout_request_id TEXT,
  p_merchant_request_id TEXT,
  p_external_ref TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit public.deposits%ROWTYPE;
  v_avail INTEGER;
  v_lock INTEGER;
BEGIN
  SELECT * INTO v_deposit
  FROM public.deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND';
  END IF;

  IF v_deposit.status = 'success' THEN
    RETURN;
  END IF;

  IF p_status IS NULL OR p_status <> 'success' THEN
    UPDATE public.deposits
    SET status = 'failed',
        checkout_request_id = COALESCE(p_checkout_request_id, checkout_request_id),
        merchant_request_id = COALESCE(p_merchant_request_id, merchant_request_id),
        external_ref = COALESCE(p_external_ref, external_ref),
        updated_at = now()
    WHERE id = p_deposit_id;
    RETURN;
  END IF;

  SELECT available_cents, locked_cents INTO v_avail, v_lock
  FROM public.wallets
  WHERE user_id = v_deposit.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  UPDATE public.wallets
  SET available_cents = available_cents + v_deposit.amount_cents
  WHERE user_id = v_deposit.user_id;

  UPDATE public.deposits
  SET status = 'success',
      checkout_request_id = COALESCE(p_checkout_request_id, checkout_request_id),
      merchant_request_id = COALESCE(p_merchant_request_id, merchant_request_id),
      external_ref = COALESCE(p_external_ref, external_ref),
      updated_at = now()
  WHERE id = p_deposit_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_deposit.user_id, 'deposit_success', v_deposit.amount_cents,
    v_avail, v_avail + v_deposit.amount_cents,
    v_lock, v_lock,
    'deposits', p_deposit_id
  );

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deposit_apply_callback(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deposit_apply_callback(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
