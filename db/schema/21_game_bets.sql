-- Game bets: stake, payout, status
CREATE TABLE IF NOT EXISTS public.game_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  stake_cents INTEGER NOT NULL CHECK (stake_cents > 0),
  payout_cents INTEGER,
  status TEXT NOT NULL CHECK (status IN ('placed', 'won', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
