-- RLS: ledger
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_select_own ON public.ledger;

CREATE POLICY ledger_select_own
  ON public.ledger FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT, UPDATE, or DELETE
