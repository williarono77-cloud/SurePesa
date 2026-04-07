-- =============================================================================
-- BETTING ENGINE MIGRATION (REAL MONEY - ATOMIC)
-- Run in Supabase SQL Editor after 00_production_readiness.sql
-- Implements: scheduled-only betting, two-sided bets, lock/resolve atomically
-- =============================================================================

-- -----------------------------------------------------------------------------
-- DB2.1 ROUNDS: winning_side computed at resolve from burst_point
-- Rule: top wins if burst_point >= 1.0; bottom wins if burst_point < 1.0
-- Payout: top = stake * burst_point; bottom = stake * 2 (fixed multiplier)
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS winning_side TEXT
  CHECK (winning_side IS NULL OR winning_side IN ('top', 'bottom'));

COMMENT ON COLUMN public.game_rounds.winning_side IS
  'Set at round resolution. top=burst_point>=1.0, bottom=burst_point<1.0. Payout: top=stake*burst_point, bottom=stake*2.';

-- -----------------------------------------------------------------------------
-- DB2.2 BETS: add side, outcome; change status to placed/resolved
-- Drop old status check first (allows migration), then add new
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_bets DROP CONSTRAINT IF EXISTS game_bets_status_check;

ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS outcome TEXT;

-- Migrate existing: set side, outcome; won/lost -> resolved
UPDATE public.game_bets SET side = 'top' WHERE side IS NULL;
UPDATE public.game_bets SET status = 'resolved', outcome = CASE WHEN status = 'won' THEN 'win' WHEN status = 'lost' THEN 'loss' ELSE outcome END WHERE status IN ('won', 'lost');

ALTER TABLE public.game_bets ALTER COLUMN side SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.game_bets ADD CONSTRAINT game_bets_side_check CHECK (side IN ('top', 'bottom'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.game_bets ADD CONSTRAINT game_bets_outcome_check CHECK (outcome IS NULL OR outcome IN ('win', 'loss'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE public.game_bets ADD CONSTRAINT game_bets_status_check CHECK (status IN ('placed', 'resolved'));

-- Indexes for bet lookups
CREATE INDEX IF NOT EXISTS idx_game_bets_round_id ON public.game_bets (round_id);
CREATE INDEX IF NOT EXISTS idx_game_bets_user_id ON public.game_bets (user_id);
CREATE INDEX IF NOT EXISTS idx_game_bets_round_user ON public.game_bets (round_id, user_id);
CREATE INDEX IF NOT EXISTS idx_game_bets_status ON public.game_bets (status);

-- -----------------------------------------------------------------------------
-- Update views: use status='resolved' + outcome instead of won/lost
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_all_bets_feed AS
SELECT
  b.id,
  b.created_at,
  COALESCE(
    left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1),
    left(p.phone, 1) || '***' || right(coalesce(p.phone, '0'), 1),
    '***'
  ) AS player,
  b.stake_cents / 100.0 AS bet,
  b.stake_cents AS bet_kes,
  CASE
    WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0
    THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2)
    ELSE NULL
  END AS x,
  COALESCE(b.payout_cents, 0) / 100.0 AS win,
  COALESCE(b.payout_cents, 0) AS win_kes,
  upper(left(coalesce(p.display_name, '?'), 1)) AS avatar
FROM public.game_bets b
JOIN public.profiles p ON p.id = b.user_id
WHERE b.status = 'resolved' AND b.outcome IN ('win', 'loss')
ORDER BY b.created_at DESC;

CREATE OR REPLACE VIEW public.previous_round AS
WITH latest AS (
  SELECT * FROM public.game_rounds
  WHERE status = 'ended' AND burst_point IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  l.burst_point::numeric AS result,
  l.burst_point::numeric AS round_result,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'player', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), left(p.phone, 1) || '***' || right(coalesce(p.phone, '0'), 1), '***'),
          'player_mask', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***'),
          'bet', b.stake_cents / 100.0,
          'bet_kes', b.stake_cents,
          'x', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'multiplier', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'win', COALESCE(b.payout_cents, 0) / 100.0,
          'win_kes', COALESCE(b.payout_cents, 0),
          'avatar', upper(left(coalesce(p.display_name, '?'), 1))
        ) ORDER BY b.created_at
      )
      FROM public.game_bets b
      JOIN public.profiles p ON p.id = b.user_id
      WHERE b.round_id = l.round_id AND b.status = 'resolved' AND b.outcome IN ('win', 'loss')
    ),
    '[]'::jsonb
  ) AS previous_bets,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'player', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***'),
          'bet', b.stake_cents / 100.0,
          'x', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'win', COALESCE(b.payout_cents, 0) / 100.0,
          'avatar', upper(left(coalesce(p.display_name, '?'), 1))
        ) ORDER BY b.created_at
      )
      FROM public.game_bets b
      JOIN public.profiles p ON p.id = b.user_id
      WHERE b.round_id = l.round_id AND b.status = 'resolved' AND b.outcome IN ('win', 'loss')
    ),
    '[]'::jsonb
  ) AS bets
FROM latest l;

CREATE OR REPLACE VIEW public.public_top_bets AS
SELECT
  b.id,
  b.created_at,
  COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***') AS player,
  b.stake_cents / 100.0 AS bet,
  b.stake_cents AS bet_kes,
  COALESCE(b.payout_cents, 0) / 100.0 AS win,
  COALESCE(b.payout_cents, 0) AS win_kes,
  CASE WHEN b.stake_cents > 0 THEN round((COALESCE(b.payout_cents, 0)::numeric / b.stake_cents)::numeric, 2) ELSE 0 END AS result,
  CASE WHEN b.stake_cents > 0 THEN round((COALESCE(b.payout_cents, 0)::numeric / b.stake_cents)::numeric, 2) ELSE 0 END AS result_x,
  r.burst_point AS round_max_x,
  r.burst_point AS "roundMax",
  upper(left(coalesce(p.display_name, '?'), 1)) AS avatar
FROM public.game_bets b
JOIN public.profiles p ON p.id = b.user_id
LEFT JOIN public.game_rounds r ON r.round_id = b.round_id
WHERE b.status = 'resolved' AND b.outcome = 'win' AND b.payout_cents > 0
ORDER BY b.payout_cents DESC;

-- -----------------------------------------------------------------------------
-- RLS: game_bets - resolved bets viewable; insert only via RPC
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS game_bets_select_resolved_public ON public.game_bets;
CREATE POLICY game_bets_select_resolved_public
  ON public.game_bets FOR SELECT
  USING (status = 'resolved' AND outcome IN ('win', 'loss'));

-- -----------------------------------------------------------------------------
-- RPC: game_place_bet (SECURITY DEFINER, ATOMIC)
-- Betting ONLY when round status = 'scheduled'
-- -----------------------------------------------------------------------------
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

-- Drop old 2-arg place_bet before creating new 3-arg
DROP FUNCTION IF EXISTS public.place_bet(TEXT, INTEGER);

-- place_bet alias (backward compat; frontend uses game_place_bet with side)
CREATE OR REPLACE FUNCTION public.place_bet(
  p_round_id TEXT,
  p_side TEXT,
  p_stake_cents INTEGER
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.game_place_bet(p_round_id, p_side, p_stake_cents);
$$;
GRANT EXECUTE ON FUNCTION public.place_bet(TEXT, TEXT, INTEGER) TO authenticated;

-- -----------------------------------------------------------------------------
-- RPC: resolve_round_bets (SECURITY DEFINER, ADMIN only, IDEMPOTENT)
-- Round must be ended. Sets winning_side from burst_point. Resolves each placed bet.
-- Payout: top=stake*burst_point, bottom=stake*2
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_round_bets(p_round_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
  v_round public.game_rounds%ROWTYPE;
  v_winning_side TEXT;
  v_bet RECORD;
  v_payout_cents INTEGER;
  v_avail INTEGER;
  v_lock INTEGER;
  v_resolved_count INTEGER := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF p_round_id IS NULL OR trim(p_round_id) = '' THEN
    RAISE EXCEPTION 'INVALID_ROUND_ID';
  END IF;

  SELECT * INTO v_round
  FROM public.game_rounds
  WHERE round_id = trim(p_round_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF v_round.status <> 'ended' THEN
    RAISE EXCEPTION 'ROUND_NOT_ENDED: round must have status ended, current is %', v_round.status;
  END IF;
  IF v_round.burst_point IS NULL THEN
    RAISE EXCEPTION 'ROUND_NO_BURST: burst_point required for resolution';
  END IF;

  -- Compute winning_side: top if burst_point >= 1.0, else bottom
  v_winning_side := CASE WHEN v_round.burst_point >= 1.0 THEN 'top' ELSE 'bottom' END;

  -- Set winning_side on round (idempotent: already set if re-run)
  UPDATE public.game_rounds
  SET winning_side = v_winning_side
  WHERE id = v_round.id;

  FOR v_bet IN
    SELECT id, user_id, side, stake_cents
    FROM public.game_bets
    WHERE round_id = trim(p_round_id) AND status = 'placed'
    FOR UPDATE
  LOOP
    -- Skip if already resolved (idempotent guard)
    IF NOT EXISTS (SELECT 1 FROM public.game_bets WHERE id = v_bet.id AND status = 'placed') THEN
      CONTINUE;
    END IF;

    IF v_bet.side = v_winning_side THEN
      -- WIN: payout = stake * multiplier
      IF v_bet.side = 'top' THEN
        v_payout_cents := (v_bet.stake_cents * v_round.burst_point)::INTEGER;
      ELSE
        v_payout_cents := v_bet.stake_cents * 2;
      END IF;
      v_payout_cents := GREATEST(v_payout_cents, v_bet.stake_cents);

      SELECT available_cents, locked_cents INTO v_avail, v_lock
      FROM public.wallets WHERE user_id = v_bet.user_id FOR UPDATE;

      IF NOT FOUND OR v_lock < v_bet.stake_cents THEN
        RAISE EXCEPTION 'INVALID_STATE: wallet locked insufficient for bet %', v_bet.id;
      END IF;

      UPDATE public.wallets
      SET locked_cents = locked_cents - v_bet.stake_cents,
          available_cents = available_cents + v_payout_cents
      WHERE user_id = v_bet.user_id;

      UPDATE public.game_bets
      SET status = 'resolved', outcome = 'win', payout_cents = v_payout_cents, resolved_at = now()
      WHERE id = v_bet.id;

      INSERT INTO public.ledger (
        user_id, type, amount_cents,
        before_available_cents, after_available_cents,
        before_locked_cents, after_locked_cents,
        reference_table, reference_id
      ) VALUES (
        v_bet.user_id, 'bet_win', v_payout_cents,
        v_avail, v_avail + v_payout_cents,
        v_lock, v_lock - v_bet.stake_cents,
        'game_bets', v_bet.id
      );
    ELSE
      -- LOSS: stake is lost
      SELECT available_cents, locked_cents INTO v_avail, v_lock
      FROM public.wallets WHERE user_id = v_bet.user_id FOR UPDATE;

      IF NOT FOUND OR v_lock < v_bet.stake_cents THEN
        RAISE EXCEPTION 'INVALID_STATE: wallet locked insufficient for bet %', v_bet.id;
      END IF;

      UPDATE public.wallets
      SET locked_cents = locked_cents - v_bet.stake_cents
      WHERE user_id = v_bet.user_id;

      UPDATE public.game_bets
      SET status = 'resolved', outcome = 'loss', payout_cents = 0, resolved_at = now()
      WHERE id = v_bet.id;

      INSERT INTO public.ledger (
        user_id, type, amount_cents,
        before_available_cents, after_available_cents,
        before_locked_cents, after_locked_cents,
        reference_table, reference_id
      ) VALUES (
        v_bet.user_id, 'bet_loss', 0,
        v_avail, v_avail,
        v_lock, v_lock - v_bet.stake_cents,
        'game_bets', v_bet.id
      );
    END IF;

    v_resolved_count := v_resolved_count + 1;
  END LOOP;

  RETURN v_resolved_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_round_bets(TEXT) TO authenticated;
