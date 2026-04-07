import { useState } from 'react'
import { validateAmount, validatePhone } from '../utils/validators.js'
import { formatPhone } from '../utils/formatPhone.js'
import { fetchWithAuth } from '../utils/fetchWithAuth.js'

const POLL_INTERVAL_MS = 8000
const POLL_DURATION_MS = 90000

export default function DepositPanel({ onDepositSuccess, setMessage }) {
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingRef, setPendingRef] = useState(null)
  const [inlineError, setInlineError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setInlineError(null)
    const normalized = formatPhone(phone)
    const amountResult = validateAmount(amount)
    const phoneResult = validatePhone(phone)
    if (!amountResult.valid) {
      setInlineError(amountResult.error)
      return
    }
    if (!phoneResult.valid) {
      setInlineError(phoneResult.error)
      return
    }
    setLoading(true)
    try {
      const res = await fetchWithAuth('/stk/initiate', {
        method: 'POST',
        body: JSON.stringify({ amount: Number(amount), phone: normalized }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage?.({ type: 'error', text: data?.message || data?.error || `Request failed (${res.status})` })
        return
      }
      setMessage?.({ type: 'success', text: 'STK prompt sent. Confirm the STK prompt on your phone.' })
      setPendingRef(data?.reference || data?.CheckoutRequestID || 'pending')
      setAmount('')
      setPhone('')
      onDepositSuccess?.()
      // Optional: poll refresh for a while then stop
      const start = Date.now()
      const pollId = setInterval(() => {
        if (Date.now() - start > POLL_DURATION_MS) {
          clearInterval(pollId)
          setPendingRef(null)
          return
        }
        onDepositSuccess?.()
      }, POLL_INTERVAL_MS)
      setTimeout(() => {
        clearInterval(pollId)
        setPendingRef(null)
      }, POLL_DURATION_MS)
    } catch (err) {
      setMessage?.({ type: 'error', text: err?.message || 'Failed to initiate deposit' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel deposit-panel">
      <h3>Deposit (STK Push)</h3>
      {pendingRef && (
        <p className="deposit-panel__pending">Pending confirmation… Check your phone. You can refresh the page to see updates.</p>
      )}
      <form onSubmit={handleSubmit}>
        {inlineError && <p className="text-error">{inlineError}</p>}
        <label>
          Phone (Kenya)
          <input
            type="tel"
            placeholder="07XXXXXXXX or 2547XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Amount
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? 'Sending…' : 'Initiate deposit'}
        </button>
      </form>
    </section>
  )
}
