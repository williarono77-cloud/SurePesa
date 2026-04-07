-- Auto-create profile and wallet on auth.users insert (idempotent)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, created_at)
  VALUES (NEW.id, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, available_cents, locked_cents, created_at)
  VALUES (NEW.id, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();
