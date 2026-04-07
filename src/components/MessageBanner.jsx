import { useEffect } from 'react'

export default function MessageBanner({ message, onDismiss }) {
  useEffect(() => {
    if (!message?.text) return
    const t = setTimeout(() => onDismiss?.(), 6000)
    return () => clearTimeout(t)
  }, [message?.text, onDismiss])

  if (!message?.text) return null

  const isError = message.type === 'error'
  return (
    <div className={`message-banner ${isError ? 'message-banner--error' : 'message-banner--success'}`} role="alert">
      <span>{message.text}</span>
      <button type="button" className="message-banner__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
