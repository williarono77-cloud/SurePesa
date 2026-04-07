import { formatMoney } from '../utils/formatMoney.js'
import ThemeToggle from './ThemeToggle.jsx'

export default function HeaderRow({ balance, onMenuClick, onChatClick, onAuthClick }) {
  const isLoggedIn = balance !== null && balance !== undefined
  const displayBalance = isLoggedIn ? formatMoney(balance) : null

  return (
    <div className="header-row">
      <h1 className="header-row__logo">Aviator</h1>
      <div className="header-row__right">
        {isLoggedIn ? (
          <div className="header-row__balance">{displayBalance}</div>
        ) : (
          <button type="button" className="header-row__auth-btn" onClick={onAuthClick}>
            Login / Register
          </button>
        )}
        <div className="header-row__icons">
          <ThemeToggle />
          <button type="button" className="header-row__icon-btn" onClick={onChatClick} aria-label="Chat">
            💬
          </button>
          <button type="button" className="header-row__icon-btn" onClick={onMenuClick} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
    </div>
  )
}
