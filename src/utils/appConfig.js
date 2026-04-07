import { supabase, isSupabaseConfigured } from "../supabaseClient.js";

// Fetch a config value by key from public.app_config
export async function getAppConfigValue(key) {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", key)
    .single();

  if (error) return null;
  return data?.value ?? null;
}
