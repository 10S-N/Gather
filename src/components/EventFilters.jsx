import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_EMOJI, NEIGHBORHOOD_NAMES } from '../data/neighborhoods';
import { PRICE_OPTIONS, SORT_OPTIONS, WHEN_OPTIONS } from '../utils/events';

// Short summary for the closed picker: "All Austin neighborhoods", the one you
// picked, or a count once several are on.
function neighborhoodLabel(selected) {
  if (selected.length === 0) return 'All Austin neighborhoods';
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} + 1`;
  return `${selected.length} neighborhoods`;
}

// A checkbox menu rather than a <select multiple>: with 18 neighborhoods a
// native multi-select needs modifier keys and hides the selection, and a chip
// row would scroll twelve options off screen. Each option carries its count, so
// an option that would return nothing is visible (and unclickable) instead of
// being a surprise.
export function NeighborhoodMenu({ selected, counts, onToggle, onClear }) {
  return (
    <div className="multi__menu">
      <div className="multi__head">
        <span>
          {selected.length
            ? `${selected.length} selected`
            : `${NEIGHBORHOOD_NAMES.length} Austin neighborhoods`}
        </span>
        {selected.length > 0 && (
          <button type="button" className="multi__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <ul className="multi__list" role="group" aria-label="Neighborhoods">
        {NEIGHBORHOOD_NAMES.map((name) => {
          const count = counts[name] || 0;
          const active = selected.includes(name);
          // Matching the category chips: an option that would return nothing is
          // disabled, but a picked one always stays clickable so a selection can
          // never become impossible to undo.
          const classes = ['multi__option'];
          if (active) classes.push('is-active');
          if (count === 0 && !active) classes.push('is-empty');
          return (
            <li key={name}>
              <label className={classes.join(' ')}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={count === 0 && !active}
                  onChange={() => onToggle(name)}
                />
                <span className="multi__name">{name}</span>
                <span className="multi__count">{count}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NeighborhoodPicker({ selected, counts, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="multi" ref={rootRef}>
      <button
        type="button"
        className={`select select--multi ${open ? 'is-open' : ''} ${
          selected.length ? 'is-active' : ''
        }`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        {neighborhoodLabel(selected)}
      </button>

      {open && (
        <NeighborhoodMenu
          selected={selected}
          counts={counts}
          onToggle={onToggle}
          onClear={onClear}
        />
      )}
    </div>
  );
}

function EventFilters({
  category,
  onCategoryChange,
  neighborhoods,
  neighborhoodCounts,
  onToggleNeighborhood,
  onClearNeighborhoods,
  when,
  onWhenChange,
  price,
  onPriceChange,
  dateFrom,
  dateTo,
  onDateChange,
  sort,
  onSortChange,
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
        <div className="control">
          <span className="control__label" id="neighborhood-label">
            Neighborhoods
          </span>
          <NeighborhoodPicker
            selected={neighborhoods}
            counts={neighborhoodCounts}
            onToggle={onToggleNeighborhood}
            onClear={onClearNeighborhoods}
          />
        </div>

        <label className="control">
          <span className="control__label">Quick date</span>
          <select className="select" value={when} onChange={(e) => onWhenChange(e.target.value)}>
            {WHEN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control__label">Price</span>
          <select className="select" value={price} onChange={(e) => onPriceChange(e.target.value)}>
            {PRICE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control control--date">
          <span className="control__label">From</span>
          <input
            type="date"
            className="input"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => onDateChange({ dateFrom: e.target.value })}
            aria-label="Events on or after this date"
          />
        </label>

        <label className="control control--date">
          <span className="control__label">To</span>
          <input
            type="date"
            className="input"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => onDateChange({ dateTo: e.target.value })}
            aria-label="Events on or before this date"
          />
        </label>

        <div className="feed__spacer" />

        <label className="control">
          <span className="control__label">Sort</span>
          <select className="select" value={sort} onChange={(e) => onSortChange(e.target.value)}>
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
