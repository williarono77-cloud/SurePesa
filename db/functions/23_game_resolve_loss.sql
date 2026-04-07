-- Admin: resolve bet as loss; reduce locked, no payout
CREATE OR REPLACE FUNCTION public.game_resolve_loss(p_bet_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
  v_bet public.game_bets%ROWTYPE;
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

  SELECT * INTO v_bet
  FROM public.game_bets
  WHERE id = p_bet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BET_NOT_FOUND';
  END IF;

  IF v_bet.status <> 'placed' THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT available_cents, locked_cents INTO v_avail, v_lock
  FROM public.wallets
  WHERE user_id = v_bet.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_lock < v_bet.stake_cents THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  UPDATE public.wallets
  SET locked_cents = locked_cents - v_bet.stake_cents
  WHERE user_id = v_bet.user_id;

  UPDATE public.game_bets
  SET status = 'lost', payout_cents = 0, resolved_at = now()
  WHERE id = p_bet_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_bet.user_id, 'bet_lost', 0,
    v_avail, v_avail,
    v_lock, v_lock - v_bet.stake_cents,
    'game_bets', p_bet_id
  );

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.game_resolve_loss(UUID) TO authenticated;
