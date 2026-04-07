/**
 * Normalize Kenya phone number to 2547XXXXXXXX format.
 * Accepts: 07XXXXXXXX, 2547XXXXXXXX, +2547..., with optional spaces.
 * @param {string} input - Raw phone input
 * @returns {string} Normalized form or empty string if invalid
 */
export function formatPhone(input) {
  if (!input || typeof input !== 'string') return ''
  const cleaned = input.replace(/\s+/g, '').replace(/^\+/, '')
  if (/^2547\d{8}$/.test(cleaned)) return cleaned
  if (/^07\d{8}$/.test(cleaned)) return '254' + cleaned.slice(1)
  if (/^7\d{8}$/.test(cleaned)) return '254' + cleaned
  return ''
}

/**
 * Get normalized phone for display/API; returns original if already valid format.
 */
export function normalizePhone(input) {
  const formatted = formatPhone(input)
  return formatted || input.trim()
}
