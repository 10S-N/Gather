import { SORT_OPTIONS } from '../utils/events';

// The strip between the filters and the grid: how many results there are, in
// what order, and which view. It deliberately does not repeat the chosen
// filters — the controls above already show their own state, and repeating it
// only gave the page another line of text to read.
function ResultsBar({ count, query, sort, onSortChange, view, onViewChange }) {
  const needle = query.trim();
  return (
    <div className="results-bar">
      <span className="results-bar__count">
        {count} event{count === 1 ? '' : 's'}
        {needle ? ` for “${needle}”` : ''}
      </span>

      <div className="results-bar__actions">
        <label className="results-bar__sort">
          <span className="sr-only">Sort events</span>
          <select
            className="select select--compact"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

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
      </div>
    </div>
  );
}

export default ResultsBar;
