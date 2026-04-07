import { useEffect } from 'react'

export default function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message?.text) return
    const t = setTimeout(() => onDismiss?.(), 5000)
    return () => clearTimeout(t)
  }, [message?.text, onDismiss])

  if (!message?.text) return null

  const type = message.type || 'info'
  return (
    <div className={`toast toast--${type}`} role="alert">
      <span className="toast__message">{message.text}</span>
      <button type="button" className="toast__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
