-- RLS: profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Public read for users with resolved bets (feed views: public_all_bets_feed, previous_round, public_top_bets)
CREATE POLICY profiles_select_public_bettors
  ON public.profiles FOR SELECT
  USING (id IN (SELECT user_id FROM public.game_bets WHERE status IN ('won', 'lost')));
