-- Admin read-only for deposits (run after 09_deposits_rls.sql)
-- Admins can SELECT all deposits; no UPDATE.

CREATE POLICY deposits_admin_select
  ON public.deposits FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
