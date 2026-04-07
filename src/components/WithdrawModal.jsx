import { useState, useEffect } from 'react'
import { validateAmount, validatePhone } from '../utils/validators.js'
import { formatPhone } from '../utils/formatPhone.js'
import { supabase } from '../supabaseClient.js'
import { formatMoney } from '../utils/formatMoney.js'

export default function WithdrawModal({ isOpen, onClose, userId, balance, lastDepositPhone, onWithdrawSuccess, setMessage }) {
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [inlineError, setInlineError] = useState(null)

  const walletBalance = Number(balance) || 0
  const canSubmit = Boolean(userId)

  useEffect(() => {
    if (isOpen) {
      setPhone(lastDepositPhone || '')
      setAmount('')
      setInlineError(null)
    }
  }, [isOpen, lastDepositPhone])

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
    if (!userId) {
      setInlineError('You must be logged in to withdraw.')
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
      onClose()
    } catch (err) {
      const errorMsg = err?.message || 'Failed to submit withdrawal request'
      setInlineError(errorMsg)
      setMessage?.({ type: 'error', text: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal__title">Withdraw</h2>
        <form className="modal__form" onSubmit={handleSubmit}>
          {inlineError && <p className="text-error">{inlineError}</p>}
          <div className="modal__label">
            <span className="modal__label-text">Phone (Kenya)</span>
            <input
              type="tel"
              className="modal__input"
              placeholder="07XXXXXXXX or 2547XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="modal__label">
            <span className="modal__label-text">Amount (max: {formatMoney(walletBalance)})</span>
            <input
              type="number"
              className="modal__input"
              min="1"
              max={walletBalance}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
            />
          </div>
          <button type="submit" className="modal__button" disabled={loading || !canSubmit}>
            {loading ? 'Submitting…' : !canSubmit ? 'Log in to withdraw' : 'Request Withdrawal'}
          </button>
        </form>
        <p className="modal__hint">Admin will review and pay manually to your phone number.</p>
      </div>
    </div>
  )
}
