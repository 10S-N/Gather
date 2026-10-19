import { CATEGORIES, CATEGORY_EMOJI, NEIGHBORHOOD_NAMES } from '../data/neighborhoods';
import { WHEN_OPTIONS } from '../utils/events';

function EventFilters({
  category,
  onCategoryChange,
  neighborhood,
  onNeighborhoodChange,
  when,
  onWhenChange,
  counts,
  total,
  view,
  onViewChange,
  onReset,
  hasActiveFilters,
}) {
  return (
    <div className="feed__toolbar">
      <div className="chip-row" role="group" aria-label="Filter by category">
        <button
          type="button"
          className={`chip ${category === 'All' ? 'is-active' : ''}`}
          aria-pressed={category === 'All'}
          onClick={() => onCategoryChange('All')}
        >
          All events
          <span className="chip__count">{total}</span>
        </button>

        {CATEGORIES.map((cat) => {
          const count = counts[cat] || 0;
          return (
            <button
              key={cat}
              type="button"
              className={`chip ${category === cat ? 'is-active' : ''}`}
              aria-pressed={category === cat}
              onClick={() => onCategoryChange(cat)}
              disabled={count === 0 && category !== cat}
            >
              <span aria-hidden="true">{CATEGORY_EMOJI[cat]}</span> {cat}
              {count > 0 && <span className="chip__count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="feed__controls">
        <label className="control">
          <span className="control__label">Neighborhood</span>
          <select
            className="select"
            value={neighborhood}
            onChange={(e) => onNeighborhoodChange(e.target.value)}
          >
            <option value="All">All neighborhoods</option>
            {NEIGHBORHOOD_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control__label">When</span>
          <select className="select" value={when} onChange={(e) => onWhenChange(e.target.value)}>
            {WHEN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="feed__spacer" />

        <div className="view-toggle" role="group" aria-label="Choose a view">
          <button
            type="button"
            className={view === 'grid' ? 'is-active' : ''}
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
          >
            <span aria-hidden="true">▦</span> Cards
          </button>
          <button
            type="button"
            className={view === 'map' ? 'is-active' : ''}
            aria-pressed={view === 'map'}
            onClick={() => onViewChange('map')}
          >
            <span aria-hidden="true">🗺</span> Map
          </button>
        </div>

        {hasActiveFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

export default EventFilters;
