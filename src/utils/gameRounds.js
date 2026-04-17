import { supabase } from "../supabaseClient.js";

export async function fetchActiveRound() {
  const { data, error } = await supabase.rpc("get_or_promote_active_round");

  if (error) throw error;
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return data[0];
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
