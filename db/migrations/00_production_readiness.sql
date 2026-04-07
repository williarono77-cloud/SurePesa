-- =============================================================================
-- PRODUCTION READINESS MIGRATION
-- Run in Supabase SQL Editor. Apply after existing schema/rls/functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- DB2.1 app_config (for M-Pesa manual deposit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_config_select_public ON public.app_config;
CREATE POLICY app_config_select_public ON public.app_config FOR SELECT USING (true);

INSERT INTO public.app_config (key, value, updated_at)
VALUES 
  ('mpesa_manual_number', '07XXXXXXXX', now()),
  ('mpesa_manual_note', '', now())
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- DB2.2 game_rounds statuses (add scheduled)
-- -----------------------------------------------------------------------------
ALTER TABLE public.game_rounds DROP CONSTRAINT IF EXISTS game_rounds_status_check;
ALTER TABLE public.game_rounds ADD CONSTRAINT game_rounds_status_check
  CHECK (status IN ('scheduled', 'live', 'ended'));

CREATE INDEX IF NOT EXISTS idx_game_rounds_status_round_number 
  ON public.game_rounds (status, round_number);
CREATE INDEX IF NOT EXISTS idx_game_rounds_status_created 
  ON public.game_rounds (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- DB2.3 Views: next_rounds_public, next_rounds_admin, current_round
-- -----------------------------------------------------------------------------
-- next_rounds_public: scheduled rounds WITHOUT burst_point (safe for users)
CREATE OR REPLACE VIEW public.next_rounds_public AS
SELECT id, round_id, round_number, status, starts_at, created_at
FROM public.game_rounds
WHERE status = 'scheduled'
ORDER BY round_number ASC
LIMIT 12;

-- next_rounds_admin: scheduled rounds WITH burst_point (admin only via RLS)
CREATE OR REPLACE VIEW public.next_rounds_admin AS
SELECT id, round_id, round_number, status, burst_point, starts_at, created_at
FROM public.game_rounds
WHERE status = 'scheduled'
ORDER BY round_number ASC
LIMIT 12;

-- current_round: live round OR most recent ended (never scheduled)
CREATE OR REPLACE VIEW public.current_round AS
SELECT *
FROM (
  SELECT
    id, round_id, round_number AS round, round_number AS round_number,
    burst_point, burst_point AS multiplier, burst_point AS current_multiplier,
    status AS state, status, starts_at, ended_at, created_at
  FROM public.game_rounds
  WHERE status IN ('live', 'ended')
  ORDER BY 
    CASE WHEN status = 'live' THEN 0 ELSE 1 END,
    created_at DESC
  LIMIT 1
) sub;

-- -----------------------------------------------------------------------------
-- DB2.4 Admin check helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin',
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- DB2.5 RLS fixes (CRITICAL: hide burst_point from non-admins for scheduled)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS game_rounds_select_public ON public.game_rounds;
DROP POLICY IF EXISTS game_rounds_select_admin ON public.game_rounds;

-- Non-admins: SELECT only live/ended (no scheduled = no burst_point leak)
CREATE POLICY game_rounds_select_public
  ON public.game_rounds FOR SELECT
  USING (status IN ('live', 'ended'));

-- Admins: SELECT all rows (including scheduled with burst_point)
CREATE POLICY game_rounds_select_admin
  ON public.game_rounds FOR SELECT
  USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- DB2.6 Round queue RPCs (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- generate_next_rounds: admin only, top up to p_target scheduled rounds
CREATE OR REPLACE FUNCTION public.generate_next_rounds(p_target int DEFAULT 12)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_max_num int;
  v_i int;
  v_round_id text;
  v_burst numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT COALESCE(MAX(round_number), 0) INTO v_max_num FROM public.game_rounds;
  SELECT COUNT(*) INTO v_count FROM public.game_rounds WHERE status = 'scheduled';

  IF v_count >= p_target THEN
    RETURN 0;
  END IF;

  FOR v_i IN 1..(p_target - v_count) LOOP
    v_max_num := v_max_num + 1;
    v_round_id := 'round-' || v_max_num;
    v_burst := CASE (v_max_num % 13)
      WHEN 0 THEN 0.5 + random() * 0.5
      WHEN 1 THEN 1.0 + random() * 0.5
      WHEN 2,3,4 THEN 1.5 + random() * 4.0
      WHEN 5,6,7 THEN 7.0 + random() * 5.0
      WHEN 8,9 THEN 10.0 + random() * 20.0
      ELSE 30.0 + random() * 20.0
    END;

    INSERT INTO public.game_rounds (round_id, round_number, burst_point, status, starts_at, created_at)
    VALUES (v_round_id, v_max_num, round(v_burst::numeric, 2), 'scheduled', now(), now());
  END LOOP;

  RETURN p_target - v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_next_rounds(int) TO authenticated;

-- consume_round: promote next scheduled to live when current round ended (atomic, idempotent)
-- p_round_id: UUID of the ended round (game_rounds.id)
CREATE OR REPLACE FUNCTION public.consume_round(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round public.game_rounds%ROWTYPE;
  v_next public.game_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND';
  END IF;
  IF v_round.status <> 'ended' THEN
    RAISE EXCEPTION 'ROUND_NOT_ENDED: round must have status ended';
  END IF;

  -- Promote first scheduled to live (atomic)
  SELECT * INTO v_next FROM public.game_rounds
  WHERE status = 'scheduled'
  ORDER BY round_number ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.game_rounds
    SET status = 'live', starts_at = now()
    WHERE id = v_next.id;
  END IF;
  RETURN;
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_round(uuid) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- DB2.7 get_next_rounds_public RPC (frontend uses this – must include burst_point for GameCard)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_rounds_public()
RETURNS TABLE(id uuid, round_id text, round_number int, burst_point numeric, status text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.round_id, r.round_number, r.burst_point, r.status, r.created_at
  FROM public.game_rounds r
  WHERE r.status = 'scheduled'
  ORDER BY r.round_number ASC
  LIMIT 12;
$$;
GRANT EXECUTE ON FUNCTION public.get_next_rounds_public() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- DB2.8 place_bet alias (app expects place_bet, DB has game_place_bet)
-- game_bets.round_id is TEXT; pass round_id (e.g. 'round-1051'), not id (uuid)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(p_round_id text, p_stake_cents int)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.game_place_bet(p_round_id, p_stake_cents);
$$;
GRANT EXECUTE ON FUNCTION public.place_bet(text, int) TO authenticated;

-- -----------------------------------------------------------------------------
-- DB2.9 Admin wallets select (platform balance stats)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS wallets_admin_select ON public.wallets;
CREATE POLICY wallets_admin_select
  ON public.wallets FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
