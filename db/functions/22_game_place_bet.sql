-- User: place bet; lock funds and create game_bets row
-- Betting ONLY when round status = 'scheduled'. Supports top/bottom sides.
CREATE OR REPLACE FUNCTION public.game_place_bet(
  p_round_id TEXT,
  p_side TEXT,
  p_stake_cents INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_available INTEGER;
  v_locked INTEGER;
  v_bet_id UUID;
  v_round_status TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_side IS NULL OR lower(trim(p_side)) NOT IN ('top', 'bottom') THEN
    RAISE EXCEPTION 'INVALID_SIDE: must be top or bottom';
  END IF;

  IF p_stake_cents IS NULL OR p_stake_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_STAKE';
  END IF;

  IF p_round_id IS NULL OR trim(p_round_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ROUND_ID';
  END IF;

  -- CRITICAL: betting allowed ONLY when round is scheduled
  SELECT status INTO v_round_status
  FROM public.game_rounds
  WHERE round_id = trim(p_round_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF v_round_status <> 'scheduled' THEN
    RAISE EXCEPTION 'BETTING_CLOSED: round must be scheduled, current status is %', v_round_status;
  END IF;

  SELECT available_cents, locked_cents
  INTO v_available, v_locked
  FROM public.wallets
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  IF v_available < p_stake_cents THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  UPDATE public.wallets
  SET available_cents = available_cents - p_stake_cents,
      locked_cents = locked_cents + p_stake_cents
  WHERE user_id = v_uid;

  INSERT INTO public.game_bets (user_id, round_id, side, stake_cents, status)
  VALUES (v_uid, trim(p_round_id), lower(trim(p_side)), p_stake_cents, 'placed')
  RETURNING id INTO v_bet_id;

  INSERT INTO public.ledger (
    user_id, type, amount_cents,
    before_available_cents, after_available_cents,
    before_locked_cents, after_locked_cents,
    reference_table, reference_id
  ) VALUES (
    v_uid, 'bet_lock', -p_stake_cents,
    v_available, v_available - p_stake_cents,
    v_locked, v_locked + p_stake_cents,
    'game_bets', v_bet_id
  );

  RETURN v_bet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.game_place_bet(TEXT, TEXT, INTEGER) TO authenticated;
