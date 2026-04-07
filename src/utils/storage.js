/**
 * localStorage helpers for persisting UI toggles (sound, music, animation).
 */

const PREFIX = 'aviator_'

export function getToggle(key) {
  try {
    const val = localStorage.getItem(PREFIX + key)
    if (val === 'true' || val === 'false') {
      return val === 'true'
    }
    return val || false
  } catch {
    return false
  }
}

export function setToggle(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value))
  } catch {
    // Ignore localStorage errors
  }
}

export function getStake(key) {
  try {
    const val = localStorage.getItem(PREFIX + 'stake_' + key)
    return val ? Number(val) : null
  } catch {
    return null
  }
}

export function setStake(key, value) {
  try {
    localStorage.setItem(PREFIX + 'stake_' + key, String(value))
  } catch {
    // Ignore localStorage errors
  }
}

/** Auth role cache: keyed by user id so role survives refresh but not user switch. */
const ROLE_KEY = PREFIX + 'role'
const ROLE_USER_KEY = PREFIX + 'role_user_id'

export function getAuthRole(userId) {
  if (!userId) return null
  try {
    const storedId = localStorage.getItem(ROLE_USER_KEY)
    const role = localStorage.getItem(ROLE_KEY)
    if (storedId === userId && role) return role
    return null
  } catch {
    return null
  }
}

export function setAuthRole(userId, role) {
  try {
    if (!userId) return
    localStorage.setItem(ROLE_USER_KEY, String(userId))
    localStorage.setItem(ROLE_KEY, String(role ?? ''))
  } catch {
    // Ignore
  }
}

export function clearAuthRole() {
  try {
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(ROLE_USER_KEY)
  } catch {
    // Ignore
  }
}
