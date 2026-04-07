-- Ledger: immutable transaction log per user, amount in cents
CREATE TABLE IF NOT EXISTS public.ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  before_available_cents INTEGER,
  after_available_cents INTEGER,
  before_locked_cents INTEGER,
  after_locked_cents INTEGER,
  reference_table TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
