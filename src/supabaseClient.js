import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Flag so the UI can behave differently when Supabase isn't configured yet.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// Use placeholders when .env is missing so createClient doesn't throw and the app can render.
// Auth and data will fail until you set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
const url = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co'
const key = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key'

export const supabase = createClient(url, key)




