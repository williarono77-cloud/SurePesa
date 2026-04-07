-- Admin: reject deposit
CREATE OR REPLACE FUNCTION public.admin_deposit_reject(p_deposit_id UUID, p_admin_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
  v_deposit public.deposits%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT * INTO v_deposit
  FROM public.deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND';
  END IF;

  IF v_deposit.status NOT IN ('submitted', 'pending_submit') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  UPDATE public.deposits
  SET status = 'rejected',
      admin_note = p_admin_note,
      updated_at = now()
  WHERE id = p_deposit_id;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_deposit_reject(UUID, TEXT) TO authenticated;
