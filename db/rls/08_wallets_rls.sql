-- RLS: wallets
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallets_select_own ON public.wallets;

CREATE POLICY wallets_select_own
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT, UPDATE, or DELETE
