import { useState } from 'react'
import { validateAmount, validatePhone } from '../utils/validators.js'
import { formatPhone } from '../utils/formatPhone.js'
import { supabase } from '../supabaseClient.js'

export default function WithdrawPanel({ userId, balance, lastDepositPhone, onWithdrawSuccess, setMessage }) {
  const [phone, setPhone] = useState(lastDepositPhone || '')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [inlineError, setInlineError] = useState(null)

  const walletBalance = Number(balance) || 0

  async function handleSubmit(e) {
    e.preventDefault()
    setInlineError(null)
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
    const numAmount = Number(amount)
    if (numAmount > walletBalance) {
      setInlineError('Amount cannot exceed your wallet balance')
      return
    }
    setLoading(true)
    try {
      const amountCents = Math.floor(numAmount * 100)
      const phoneValue = formatPhone(phone) || phone.trim()

      const { error } = await supabase.rpc('withdraw_request', {
        p_amount_cents: amountCents,
        p_phone: phoneValue,
      })

      if (error) throw error

      setMessage?.({
        type: 'success',
        text: 'Withdrawal request sent. Funds are locked and admin will review and pay manually to your phone.',
      })
      setAmount('')
      onWithdrawSuccess?.()
    } catch (err) {
      setMessage?.({ type: 'error', text: err?.message || 'Failed to submit withdrawal request' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel withdraw-panel">
      <h3>Withdraw</h3>
      <p className="withdraw-panel__hint">Request a manual payout. Admin will review and pay to your phone.</p>
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
          Amount (max: {walletBalance})
          <input
            type="number"
            min="1"
            max={walletBalance}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? 'Submitting…' : 'Request withdrawal'}
        </button>
      </form>
    </section>
  )
}
