-- RLS: withdrawal_requests
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS withdrawal_requests_select_own ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_insert_own ON public.withdrawal_requests;

CREATE POLICY withdrawal_requests_select_own
  ON public.withdrawal_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY withdrawal_requests_insert_own
  ON public.withdrawal_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- No UPDATE or DELETE
