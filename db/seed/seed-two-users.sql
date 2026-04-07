-- =============================================================================
-- MINIMAL SEED — 2 USERS ONLY (admin + user)
-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor (no service role key needed).
-- Password for both: password123
--
-- After running:
--   user@test.com  / password123  (regular user)
--   admin@test.com / password123  (admin — use to open Admin Dashboard)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_pw TEXT := crypt('password123', gen_salt('bf'));
  v_uid_user  UUID := 'a0000001-0001-0000-0000-000000000001';
  v_uid_admin UUID := 'a0000004-0004-0000-0000-000000000004';
BEGIN
  -- user@test.com
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_user, v_uid_user, format('{"sub": "%s", "email": "user@test.com"}', v_uid_user)::jsonb, 'email', v_uid_user::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_user AND provider = 'email');

  -- admin@test.com
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_uid_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.com', v_pw, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT v_uid_admin, v_uid_admin, format('{"sub": "%s", "email": "admin@test.com"}', v_uid_admin)::jsonb, 'email', v_uid_admin::text, now(), now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid_admin AND provider = 'email');
END $$;

-- Profiles and wallets (trigger may have created defaults; upsert role and balance)
INSERT INTO public.profiles (id, display_name, role, created_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', 'Test User', 'user', now()),
  ('a0000004-0004-0000-0000-000000000004', 'Admin', 'admin', now())
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role;

INSERT INTO public.wallets (user_id, available_cents, locked_cents, created_at)
VALUES
  ('a0000001-0001-0000-0000-000000000001', 100000, 0, now()),
  ('a0000004-0004-0000-0000-000000000004', 100000, 0, now())
ON CONFLICT (user_id) DO UPDATE SET available_cents = EXCLUDED.available_cents, locked_cents = EXCLUDED.locked_cents;
