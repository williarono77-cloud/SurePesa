import ThemeToggle from './ThemeToggle.jsx'

export default function TopBar({ onBack, fullscreen, onToggleFullscreen, onDepositClick }) {
  return (
    <div className="top-bar">
      <div className="top-bar__left">
        <button type="button" className="top-bar__back" onClick={onBack}>
          <span>‹</span>
          <span>Go Back</span>
        </button>
      </div>
      <div className="top-bar__right">
        <button
          type="button"
          className="bet-panel__bet-btn"
          onClick={onDepositClick}
        >
          <span>Deposit</span>
          <span>＋</span>
        </button>
        <button type="button" className="top-bar__fullscreen" onClick={onToggleFullscreen}>
          <span>{fullscreen ? 'Exit Fullscreen' : 'View Fullscreen'}</span>
          <span>{fullscreen ? '⤓' : '⤢'}</span>
        </button>
      </div>
    </div>
  )
}
