-- RLS: game_bets
ALTER TABLE public.game_bets ENABLE ROW LEVEL SECURITY;

-- Own bets: users see their own
CREATE POLICY game_bets_select_own
  ON public.game_bets FOR SELECT
  USING (auth.uid() = user_id);

-- Public read of resolved bets: for public_all_bets_feed, previous_round, public_top_bets
CREATE POLICY game_bets_select_resolved_public
  ON public.game_bets FOR SELECT
  USING (status IN ('won', 'lost'));
