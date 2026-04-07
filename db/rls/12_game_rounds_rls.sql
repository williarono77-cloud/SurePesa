-- RLS: game_rounds (public read for current_round, recent_multipliers)
ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;

-- Public read: anyone can see rounds (used by current_round, recent_multipliers views)
CREATE POLICY game_rounds_select_public
  ON public.game_rounds FOR SELECT
  USING (true);
