-- RLS: deposits
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deposits_select_own ON public.deposits;
DROP POLICY IF EXISTS deposits_insert_own ON public.deposits;

CREATE POLICY deposits_select_own
  ON public.deposits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY deposits_insert_own
  ON public.deposits FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'initiated');
-- No UPDATE or DELETE
