-- =============================================================================
-- ADMIN END ROUND MIGRATION
-- Run in Supabase SQL Editor after 01_betting_engine.sql
-- Provides RPC for admin to end live round (required before resolve_round_bets)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_end_round(p_round_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  UPDATE public.game_rounds
  SET status = 'ended', ended_at = now()
  WHERE id = p_round_id AND status = 'live';

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 0 THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND_OR_NOT_LIVE';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_end_round(UUID) TO authenticated;
