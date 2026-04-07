import { formatMoney } from '../utils/formatMoney.js'

function formatDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString()
}

export default function TransactionsPanel({ deposits = [], withdrawals = [] }) {
  return (
    <section className="panel transactions-panel">
      <h3>Transactions</h3>
      <div className="transactions-panel__grid">
        <div>
          <h4>Deposits</h4>
          {deposits.length === 0 ? (
            <p className="text-muted">No deposits yet.</p>
          ) : (
            <ul className="transactions-list">
              {deposits.map((d, i) => {
                const amountCents = d.amount_cents ?? 0
                const amount = amountCents / 100
                return (
                  <li key={d.id || i}>
                    <span className="transactions-list__amount">{formatMoney(amount)}</span>
                    <span className="transactions-list__status">{d.status ?? 'pending'}</span>
                    <span className="transactions-list__date">{formatDate(d.created_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div>
          <h4>Withdrawal requests</h4>
          {withdrawals.length === 0 ? (
            <p className="text-muted">No withdrawal requests yet.</p>
          ) : (
            <ul className="transactions-list">
              {withdrawals.map((w, i) => {
                const amountCents = w.amount_cents ?? 0
                const amount = amountCents / 100
                return (
                  <li key={w.id || i}>
                    <span className="transactions-list__amount">{formatMoney(amount)}</span>
                    <span className="transactions-list__status">{w.status ?? 'requested'}</span>
                    <span className="transactions-list__date">{formatDate(w.created_at)}</span>
                    {w.admin_note && <span className="transactions-list__note">{w.admin_note}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
