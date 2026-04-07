import { useEffect } from "react";
import { supabase } from "./supabaseClient";

/**
 * Listens for changes on game_rounds table.
 * When anything changes, it calls reload().
 */
export function useRealtimeRounds(reload) {
  useEffect(() => {
    const channel = supabase
      .channel("rounds-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_rounds" },
        () => {
          reload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);
}
