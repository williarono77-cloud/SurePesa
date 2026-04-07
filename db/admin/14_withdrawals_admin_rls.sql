-- Admin policies for withdrawal_requests (run after 10_withdrawals_rls.sql)
-- Admins: SELECT all; UPDATE with valid status transitions only.

DROP POLICY IF EXISTS withdrawal_requests_admin_select ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawal_requests_admin_update ON public.withdrawal_requests;

CREATE POLICY withdrawal_requests_admin_select
  ON public.withdrawal_requests FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY withdrawal_requests_admin_update
  ON public.withdrawal_requests FOR UPDATE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK (
    (
      ((SELECT status FROM public.withdrawal_requests wr WHERE wr.id = withdrawal_requests.id) = 'requested' AND status IN ('rejected', 'paid'))
      OR ((SELECT status FROM public.withdrawal_requests wr WHERE wr.id = withdrawal_requests.id) = 'rejected' AND status = 'rejected')
      OR ((SELECT status FROM public.withdrawal_requests wr WHERE wr.id = withdrawal_requests.id) = 'paid' AND status = 'paid')
    )
    AND (status NOT IN ('rejected', 'paid') OR reviewed_at IS NOT NULL)
    AND (status <> 'paid' OR paid_at IS NOT NULL)
  );