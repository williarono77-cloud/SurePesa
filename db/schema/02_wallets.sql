-- Wallets: one per user, balances in cents
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  locked_cents INTEGER NOT NULL DEFAULT 0 CHECK (locked_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
