import { supabase } from '../supabaseClient.js'

const edgeBase = import.meta.env.VITE_EDGE_BASE_URL || ''

/**
 * Call Supabase Edge Function with current session Bearer token.
 * @param {string} path - Path after base URL (e.g. '/stk/initiate')
 * @param {RequestInit} options - fetch options (method, body, headers)
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const url = `${edgeBase.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { ...options, headers })
}
