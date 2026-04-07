-- =============================================================================
-- EVIDENCE QUERIES — Run in Supabase SQL Editor after applying migrations
-- Use to verify DB objects exist and policies don't cause 500
-- =============================================================================

-- 1) Functions exist
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 2) Specific required functions (admin RPCs must exist)
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_admin',
    'generate_next_rounds',
    'consume_round',
    'admin_end_round',
    'resolve_round_bets',
    'deposit_initiate',
    'deposit_submit_mpesa_ref',
    'admin_deposit_approve',
    'admin_deposit_reject',
    'admin_withdraw_mark_paid',
    'admin_withdraw_reject',
    'game_place_bet',
    'place_bet',
    'get_next_rounds_public'
  );

-- 3) Tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 4) Views exist
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;

-- 5) RLS enabled status
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'wallets', 'deposits', 'ledger', 'withdrawal_requests', 'game_rounds', 'game_bets');

-- 6) Policies list (watch for USING(true) leaks on game_rounds/game_bets)
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 7) current_round must return only live/ended (no scheduled)
SELECT pg_get_viewdef('public.current_round'::regclass, true) AS current_round_sql;

-- 8) admin_end_round exists (BLOCKER verification)
SELECT proname, prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'admin_end_round';
