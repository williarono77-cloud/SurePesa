-- =============================================================================
-- SEED DATA — LOCAL DEVELOPMENT ONLY
-- =============================================================================
-- Deterministic, repeatable seed for testing all major features.
-- Run only against local/dev Supabase. NEVER seed production.
--
-- Prerequisites:
--   1. Apply all migrations (01-22) and functions.
--   2. Run this script via Supabase SQL Editor or: psql $DATABASE_URL -f db/seed/seed-local.sql
--
-- Auth users: Create via scripts/seed-local.js (Supabase Admin API) first, then run this.
-- Or use the auth seed block below if you have direct DB access (e.g. supabase db reset).
-- =============================================================================

-- Enable pgcrypto for password hashing (auth.users seed)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) AUTH USERS (auth.users + auth.identities)
-- -----------------------------------------------------------------------------
-- Password for all: password123
-- Trigger handle_new_user will create profile + wallet for each.
DO $$
DECLARE
  v_pw TEXT := crypt('password123', gen_salt('bf'));
  v_uid_user UUID := 'a0000001-0001-0000-0000-000000000001';
  v_uid_low UUID  := 'a0000002-0002-0000-0000-000000000002';
  v_uid_whale UUID := 'a0000003-0003-0000-0000-000000000003';
  v_uid_admin UUID := 'a0000004-0004-0000-0000-000000000004';
BEGIN
  -- user@test.com (normal, KSh 1,200)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_user, v_uid_user, format('{"sub": "%s", "email": "user@test.com"}', v_uid_user)::jsonb, 'email', v_uid_user::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_user AND provider = 'email');

  -- low@test.com (low balance KSh 80)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_low, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'low@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_low, v_uid_low, format('{"sub": "%s", "email": "low@test.com"}', v_uid_low)::jsonb, 'email', v_uid_low::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_low AND provider = 'email');

  -- whale@test.com (high balance KSh 50,000)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_whale, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'whale@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_whale, v_uid_whale, format('{"sub": "%s", "email": "whale@test.com"}', v_uid_whale)::jsonb, 'email', v_uid_whale::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_whale AND provider = 'email');

  -- admin@test.com (admin role)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_admin, v_uid_admin, format('{"sub": "%s", "email": "admin@test.com"}', v_uid_admin)::jsonb, 'email', v_uid_admin::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_admin AND provider = 'email');
END $$;

-- -----------------------------------------------------------------------------
-- 2) PROFILES (display_name) + WALLETS (balances)
-- -----------------------------------------------------------------------------
-- SEED DATA: Balances in cents. KSh 1 = 100 cents.
INSERT INTO public.profiles (id, display_name, role, created_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', 'User1', 'user', now()),
  ('a0000002-0002-0000-0000-000000000002', 'LowUser', 'user', now()),
  ('a0000003-0003-0000-0000-000000000003', 'Whale', 'user', now()),
  ('a0000004-0004-0000-0000-000000000004', 'Admin', 'admin', now())
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role;

INSERT INTO public.wallets (user_id, available_cents, locked_cents, created_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', 70000, 50000, now()),        -- KSh 1,200 total; 500 locked (pending withdrawal)
  ('a0000002-0002-0000-0000-000000000002', 8000, 0, now()),             -- KSh 80 (edge: below min withdraw 500)
  ('a0000003-0003-0000-0000-000000000003', 4500000, 0, now()),          -- KSh 50,000 (after 500 paid withdrawal)
  ('a0000004-0004-0000-0000-000000000004', 100000, 0, now())            -- KSh 1,000
ON CONFLICT (user_id) DO UPDATE SET available_cents = EXCLUDED.available_cents, locked_cents = EXCLUDED.locked_cents;

-- -----------------------------------------------------------------------------
-- 3) GAME ROUNDS (50 rounds, burst 0.0 / 1.0-5.5 / 5.5-20 / 20-50)
-- -----------------------------------------------------------------------------
-- SEED DATA: Deterministic burst values for testing header, feeds, previous round.
--
-- ROUND GENERATOR INSTRUCTIONS (PRODUCTION / SIMULATION LOGIC)
-- In any block of 13 consecutive rounds, ensure the burst_point distribution is:
--   • 3 rounds with burst_point between 0.0 and 1.0
--   • 4 rounds with burst_point between 1.0 and 5.0
--   • 3 rounds with burst_point between 7.0 and 10.0
--   • 2 rounds with burst_point between 10.0 and 30.0
--   • 1 round with burst_point between 30.0 and 50.0
--
-- A simple generator can:
--   1) Generate a 13-element template with the above ranges (e.g. using CASE on (round_number % 13)).
--   2) For each template slot, draw a random float within the configured range.
--   3) Repeat the 13-round pattern as many times as needed (e.g. round_number / 13).
-- The seed data below is fixed, but any live round generator should follow the 13-round distribution rules.
INSERT INTO public.game_rounds (round_id, round_number, burst_point, status, starts_at, ended_at, created_at)
SELECT
  'round-' || i,
  1000 + i,
  CASE (i % 15)
    WHEN 0 THEN 0.0
    WHEN 1 THEN 1.2
    WHEN 2 THEN 2.5
    WHEN 3 THEN 3.8
    WHEN 4 THEN 5.5
    WHEN 5 THEN 7.1
    WHEN 6 THEN 12.0
    WHEN 7 THEN 18.5
    WHEN 8 THEN 25.0
    WHEN 9 THEN 35.2
    WHEN 10 THEN 42.0
    WHEN 11 THEN 48.5
    WHEN 12 THEN 1.05
    WHEN 13 THEN 4.2
    ELSE 9.9
  END,
  'ended',
  now() - ((51 - i) * interval '2 minutes'),
  now() - ((51 - i) * interval '2 minutes') + interval '90 seconds',
  now() - ((51 - i) * interval '2 minutes')
FROM generate_series(1, 50) AS i
ON CONFLICT (round_id) DO NOTHING;

-- Add one live round for current_round (optional)
INSERT INTO public.game_rounds (round_id, round_number, burst_point, status, starts_at, ended_at, created_at)
VALUES ('round-live', 1051, NULL, 'live', now(), NULL, now())
ON CONFLICT (round_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) BETS (winning, losing, varied stakes)
-- -----------------------------------------------------------------------------
-- SEED DATA: Bets reference seeded users and rounds
INSERT INTO public.game_bets (user_id, round_id, stake_cents, payout_cents, status, created_at, resolved_at)
VALUES
  -- User1: mix of wins/losses
  ('a0000001-0001-0000-0000-000000000001', 'round-50', 10000, 25000, 'won', now() - interval '5 min', now() - interval '4 min'),
  ('a0000001-0001-0000-0000-000000000001', 'round-49', 5000, 0, 'lost', now() - interval '8 min', now() - interval '7 min'),
  ('a0000001-0001-0000-0000-000000000001', 'round-48', 25000, 62500, 'won', now() - interval '12 min', now() - interval '11 min'),
  ('a0000001-0001-0000-0000-000000000001', 'round-47', 1000, 0, 'lost', now() - interval '15 min', now() - interval '14 min'),
  -- LowUser: small stakes
  ('a0000002-0002-0000-0000-000000000002', 'round-50', 5000, 11000, 'won', now() - interval '5 min', now() - interval '4 min'),
  ('a0000002-0002-0000-0000-000000000002', 'round-49', 1000, 0, 'lost', now() - interval '8 min', now() - interval '7 min'),
  -- Whale: high stakes
  ('a0000003-0003-0000-0000-000000000003', 'round-50', 500000, 1250000, 'won', now() - interval '5 min', now() - interval '4 min'),
  ('a0000003-0003-0000-0000-000000000003', 'round-48', 100000, 0, 'lost', now() - interval '12 min', now() - interval '11 min'),
  ('a0000003-0003-0000-0000-000000000003', 'round-46', 250000, 975000, 'won', now() - interval '18 min', now() - interval '17 min'),
  -- Admin: some bets
  ('a0000004-0004-0000-0000-000000000004', 'round-50', 5000, 12000, 'won', now() - interval '5 min', now() - interval '4 min')
ON CONFLICT DO NOTHING;

-- Note: Wallets must reflect bet outcomes. Adjust available_cents if ledger consistency needed.
-- For seed simplicity, we set wallet balances directly; ledger entries below mirror key events.

-- -----------------------------------------------------------------------------
-- 5) DEPOSITS (below min, at min, large; success/failed)
-- -----------------------------------------------------------------------------
-- Min deposit typically 100 KSh = 10000 cents
-- SEED DATA
INSERT INTO public.deposits (user_id, phone, amount_cents, status, provider, created_at, updated_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', '254712345678', 5000, 'failed', 'mpesa', now() - interval '2 days', now()),   -- Below min (50)
  ('a0000001-0001-0000-0000-000000000001', '254712345678', 10000, 'success', 'mpesa', now() - interval '1 day', now()),  -- At min (100)
  ('a0000001-0001-0000-0000-000000000001', '254712345678', 500000, 'success', 'mpesa', now() - interval '12 hours', now()), -- Large (5000)
  ('a0000002-0002-0000-0000-000000000002', '254798765432', 10000, 'success', 'mpesa', now() - interval '3 days', now()),
  ('a0000003-0003-0000-0000-000000000003', '254711122233', 1000000, 'success', 'mpesa', now() - interval '1 week', now())  -- 10,000 KSh
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6) WITHDRAWAL REQUESTS (pending, completed, rejected)
-- -----------------------------------------------------------------------------
-- Min withdraw 500 KSh = 50000 cents. User1 has 70000 avail + 50000 locked = 120000 total.
-- SEED DATA
INSERT INTO public.withdrawal_requests (id, user_id, phone, amount_cents, status, admin_note, paid_ref, created_at, reviewed_at, paid_at)
VALUES
  (gen_random_uuid(), 'a0000001-0001-0000-0000-000000000001', '254712345678', 50000, 'requested', NULL, NULL, now() - interval '1 hour', NULL, NULL),
  (gen_random_uuid(), 'a0000003-0003-0000-0000-000000000003', '254711122233', 500000, 'paid', NULL, 'MPS-ABC123', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
  (gen_random_uuid(), 'a0000001-0001-0000-0000-000000000001', '254712345678', 100000, 'rejected', 'Invalid phone', NULL, now() - interval '5 days', now() - interval '5 days', NULL);

-- -----------------------------------------------------------------------------
-- 7) LEDGER (audit trail for deposits, bets, withdrawals)
-- -----------------------------------------------------------------------------
-- SEED DATA: Sample ledger entries
INSERT INTO public.ledger (user_id, type, amount_cents, before_available_cents, after_available_cents, before_locked_cents, after_locked_cents, reference_table, reference_id, created_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', 'deposit_success', 10000, 0, 10000, 0, 0, 'deposits', (SELECT id FROM public.deposits WHERE user_id = 'a0000001-0001-0000-0000-000000000001' AND amount_cents = 10000 LIMIT 1), now() - interval '1 day'),
  ('a0000001-0001-0000-0000-000000000001', 'deposit_success', 500000, 10000, 510000, 0, 0, 'deposits', (SELECT id FROM public.deposits WHERE user_id = 'a0000001-0001-0000-0000-000000000001' AND amount_cents = 500000 LIMIT 1), now() - interval '12 hours'),
  ('a0000001-0001-0000-0000-000000000001', 'bet_won', 25000, 510000, 535000, 10000, 0, 'game_bets', (SELECT id FROM public.game_bets WHERE user_id = 'a0000001-0001-0000-0000-000000000001' AND status = 'won' LIMIT 1), now() - interval '4 min')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SEED COMPLETE
-- =============================================================================
-- Logins:
--   user@test.com  / password123  (KSh 1,200)
--   low@test.com   / password123  (KSh 80)
--   whale@test.com / password123  (KSh 50,000)
--   admin@test.com / password123  (admin, ?admin=true in URL)
-- =============================================================================
