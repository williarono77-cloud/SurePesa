-- Admin: reject withdrawal; move locked back to available, ledger entry
CREATE OR REPLACE FUNCTION public.admin_withdraw_reject(p_request_id UUID, p_admin_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
  v_row public.withdrawal_requests%ROWTYPE;
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

  SELECT * INTO v_row
  FROM public.withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT available_cents, locked_cents INTO v_avail, v_lock
  FROM public.wallets
  WHERE user_id = v_row.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_lock < v_row.amount_cents THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  UPDATE public.wallets
  SET available_cents = available_cents + v_row.amount_cents,
      locked_cents = locked_cents - v_row.amount_cents
  WHERE user_id = v_row.user_id;

  UPDATE public.withdrawal_requests
  SET status = 'rejected', admin_note = p_admin_note, reviewed_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_row.user_id, 'withdraw_rejected_unlock', v_row.amount_cents,
    v_avail, v_avail + v_row.amount_cents,
    v_lock, v_lock - v_row.amount_cents,
    'withdrawal_requests', p_request_id
  );

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_withdraw_reject(UUID, TEXT) TO authenticated;
