-- Game rounds: burst/crash multiplier history
-- SEED SCHEMA: Required for current_round, recent_multipliers, feeds
CREATE TABLE IF NOT EXISTS public.game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id TEXT NOT NULL UNIQUE,
  round_number INTEGER NOT NULL,
  burst_point NUMERIC,
  status TEXT NOT NULL DEFAULT 'ended' CHECK (status IN ('live', 'ended')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_status_created ON public.game_rounds (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rounds_round_id ON public.game_rounds (round_id);

-- current_round: latest round (live or most recent ended)
CREATE OR REPLACE VIEW public.current_round AS
SELECT *
FROM (
  SELECT
    id,
    round_id,
    round_number AS round,
    round_number AS round_number,
    burst_point,
    burst_point AS multiplier,
    burst_point AS current_multiplier,
    status AS state,
    status,
    starts_at,
    ended_at,
    created_at
  FROM public.game_rounds
  ORDER BY created_at DESC
  LIMIT 1
) sub;

-- recent_multipliers: last 20 burst points for header (expects: id, multiplier/value/burst_point)
CREATE OR REPLACE VIEW public.recent_multipliers AS
SELECT
  id,
  burst_point AS multiplier,
  burst_point AS value,
  burst_point AS burst_point,
  round_number,
  created_at
FROM public.game_rounds
WHERE status = 'ended' AND burst_point IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- public_all_bets_feed: bets with player mask, bet, x, win (for AllBetsTable)
CREATE OR REPLACE VIEW public.public_all_bets_feed AS
SELECT
  b.id,
  b.created_at,
  COALESCE(
    left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1),
    left(p.phone, 1) || '***' || right(coalesce(p.phone, '0'), 1),
    '***'
  ) AS player,
  b.stake_cents / 100.0 AS bet,
  b.stake_cents AS bet_kes,
  CASE
    WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0
    THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2)
    ELSE NULL
  END AS x,
  COALESCE(b.payout_cents, 0) / 100.0 AS win,
  COALESCE(b.payout_cents, 0) AS win_kes,
  upper(left(coalesce(p.display_name, '?'), 1)) AS avatar
FROM public.game_bets b
JOIN public.profiles p ON p.id = b.user_id
WHERE b.status IN ('won', 'lost')
ORDER BY b.created_at DESC;

-- previous_round: most recent ended round with result + bets as JSONB (for PreviousRound)
CREATE OR REPLACE VIEW public.previous_round AS
WITH latest AS (
  SELECT * FROM public.game_rounds
  WHERE status = 'ended' AND burst_point IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  l.burst_point::numeric AS result,
  l.burst_point::numeric AS round_result,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'player', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), left(p.phone, 1) || '***' || right(coalesce(p.phone, '0'), 1), '***'),
          'player_mask', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***'),
          'bet', b.stake_cents / 100.0,
          'bet_kes', b.stake_cents,
          'x', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'multiplier', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'win', COALESCE(b.payout_cents, 0) / 100.0,
          'win_kes', COALESCE(b.payout_cents, 0),
          'avatar', upper(left(coalesce(p.display_name, '?'), 1))
        ) ORDER BY b.created_at
      )
      FROM public.game_bets b
      JOIN public.profiles p ON p.id = b.user_id
      WHERE b.round_id = l.round_id AND b.status IN ('won', 'lost')
    ),
    '[]'::jsonb
  ) AS previous_bets,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'player', COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***'),
          'bet', b.stake_cents / 100.0,
          'x', CASE WHEN b.payout_cents IS NOT NULL AND b.stake_cents > 0 THEN round((b.payout_cents::numeric / b.stake_cents)::numeric, 2) ELSE l.burst_point END,
          'win', COALESCE(b.payout_cents, 0) / 100.0,
          'avatar', upper(left(coalesce(p.display_name, '?'), 1))
        ) ORDER BY b.created_at
      )
      FROM public.game_bets b
      JOIN public.profiles p ON p.id = b.user_id
      WHERE b.round_id = l.round_id AND b.status IN ('won', 'lost')
    ),
    '[]'::jsonb
  ) AS bets
FROM latest l;

-- public_top_bets: top winning bets for TopBetsList (result, roundMax, bet, win)
CREATE OR REPLACE VIEW public.public_top_bets AS
SELECT
  b.id,
  b.created_at,
  COALESCE(left(p.display_name, 1) || '***' || right(coalesce(p.display_name, '0'), 1), '***') AS player,
  b.stake_cents / 100.0 AS bet,
  b.stake_cents AS bet_kes,
  COALESCE(b.payout_cents, 0) / 100.0 AS win,
  COALESCE(b.payout_cents, 0) AS win_kes,
  CASE WHEN b.stake_cents > 0 THEN round((COALESCE(b.payout_cents, 0)::numeric / b.stake_cents)::numeric, 2) ELSE 0 END AS result,
  CASE WHEN b.stake_cents > 0 THEN round((COALESCE(b.payout_cents, 0)::numeric / b.stake_cents)::numeric, 2) ELSE 0 END AS result_x,
  r.burst_point AS round_max_x,
  r.burst_point AS "roundMax",
  upper(left(coalesce(p.display_name, '?'), 1)) AS avatar
FROM public.game_bets b
JOIN public.profiles p ON p.id = b.user_id
LEFT JOIN public.game_rounds r ON r.round_id = b.round_id
WHERE b.status = 'won' AND b.payout_cents > 0
ORDER BY b.payout_cents DESC;
