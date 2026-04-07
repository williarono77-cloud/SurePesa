import { formatPhone } from './formatPhone.js'

/**
 * @param {string|number} value - Amount input
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAmount(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return { valid: false, error: 'Enter a valid number' }
  if (num <= 0) return { valid: false, error: 'Amount must be greater than 0' }
  return { valid: true }
}

/**
 * Basic Kenya phone validation (07... or 2547..., 9 digits after 7).
 * @param {string} value - Phone input
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePhone(value) {
  if (!value || typeof value !== 'string') return { valid: false, error: 'Phone number is required' }
  const normalized = formatPhone(value)
  if (!normalized) return { valid: false, error: 'Use a valid Kenya number (e.g. 07XXXXXXXX or 2547XXXXXXXX)' }
  return { valid: true }
}
