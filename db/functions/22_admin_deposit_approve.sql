-- Admin: approve deposit; add funds to wallet
CREATE OR REPLACE FUNCTION public.admin_deposit_approve(p_deposit_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
  v_deposit public.deposits%ROWTYPE;
  v_avail INTEGER;
  v_lock INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT * INTO v_deposit
  FROM public.deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND';
  END IF;

  IF v_deposit.status NOT IN ('submitted', 'pending_submit') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
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
  SET status = 'approved',
      updated_at = now()
  WHERE id = p_deposit_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_deposit.user_id, 'deposit_approved', v_deposit.amount_cents,
    v_avail, v_avail + v_deposit.amount_cents,
    v_lock, v_lock,
    'deposits', p_deposit_id
  );

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_deposit_approve(UUID) TO authenticated;
