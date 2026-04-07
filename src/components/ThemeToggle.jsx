import { useState, useEffect } from 'react'
import { getToggle, setToggle } from '../utils/storage.js'

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState(() => {
    const saved = getToggle('theme')
    return saved === 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (isLight) {
      root.classList.add('light-mode')
      setToggle('theme', 'light')
    } else {
      root.classList.remove('light-mode')
      setToggle('theme', 'dark')
    }
  }, [isLight])

  // Initialize theme on mount
  useEffect(() => {
    const root = document.documentElement
    const saved = getToggle('theme')
    if (saved === 'light') {
      root.classList.add('light-mode')
    } else {
      root.classList.remove('light-mode')
    }
  }, [])

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setIsLight(!isLight)}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <span className="theme-toggle__icon">{isLight ? '🌙' : '☀️'}</span>
    </button>
  )
}
