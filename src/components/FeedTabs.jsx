export default function FeedTabs({ activeTab, onTabChange }) {
  return (
    <div className="feed-tabs">
      <button
        type="button"
        className={`feed-tabs__tab ${activeTab === 'all' ? 'feed-tabs__tab--active' : ''}`}
        onClick={() => onTabChange('all')}
      >
        All Bets
      </button>
      <button
        type="button"
        className={`feed-tabs__tab ${activeTab === 'previous' ? 'feed-tabs__tab--active' : ''}`}
        onClick={() => onTabChange('previous')}
      >
        Previous
      </button>
      <button
        type="button"
        className={`feed-tabs__tab ${activeTab === 'top' ? 'feed-tabs__tab--active' : ''}`}
        onClick={() => onTabChange('top')}
      >
        Top
      </button>
    </div>
  )
}
