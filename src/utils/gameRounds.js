import { supabase } from "../supabaseClient.js";

export async function fetchActiveRound() {
  const { data, error } = await supabase
    .from("game_rounds")
    .select(
      "id, round_id, round_number, burst_point, status, created_at, starts_at, ended_at, winning_side"
    )
    .eq("status", "active")
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function advanceRound(finishedRoundId) {
  if (!finishedRoundId) {
    throw new Error("advanceRound requires finishedRoundId");
  }

  const { data, error } = await supabase.rpc("advance_round_public", {
    p_finished_round_id: finishedRoundId,
  });

  if (error) throw error;
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return data[0];
}
