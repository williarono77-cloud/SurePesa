/**
 * Format number as Kenyan Shillings currency string.
 * @param {number|string} amount - Amount to format
 * @returns {string} Formatted string like "1,234.56 KES"
 */
export function formatMoney(amount) {
  const num = Number(amount) || 0
  return num.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' KES'
}

/**
 * Format number as simple currency (no KES suffix).
 */
export function formatAmount(amount) {
  const num = Number(amount) || 0
  return num.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
