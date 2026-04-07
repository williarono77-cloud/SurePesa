-- User: lock funds and create withdrawal request; ledger entry for lock
CREATE OR REPLACE FUNCTION public.withdraw_request(p_amount_cents INTEGER, p_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_available INTEGER;
  v_locked INTEGER;
  v_request_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'INVALID_PHONE';
  END IF;

  SELECT available_cents, locked_cents
  INTO v_available, v_locked
  FROM public.wallets
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_available < p_amount_cents THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  UPDATE public.wallets
  SET available_cents = available_cents - p_amount_cents,
      locked_cents = locked_cents + p_amount_cents
  WHERE user_id = v_uid;

  INSERT INTO public.withdrawal_requests (user_id, phone, amount_cents, status)
  VALUES (v_uid, trim(p_phone), p_amount_cents, 'requested')
  RETURNING id INTO v_request_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_uid, 'withdraw_request_lock', -p_amount_cents,
    v_available, v_available - p_amount_cents,
    v_locked, v_locked + p_amount_cents,
    'withdrawal_requests', v_request_id
  );

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_request(INTEGER, TEXT) TO authenticated;
