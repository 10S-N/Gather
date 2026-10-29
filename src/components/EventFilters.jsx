import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_EMOJI, NEIGHBORHOOD_NAMES } from '../data/neighborhoods';
import { PRICE_OPTIONS, WHEN_OPTIONS } from '../utils/events';

// Short summary for the closed picker: "All Austin neighborhoods", the one you
// picked, or a count once several are on.
function neighborhoodLabel(selected) {
  if (selected.length === 0) return 'All Austin neighborhoods';
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} + 1`;
  return `${selected.length} neighborhoods`;
}

// "Nov 5" for control labels. The raw YYYY-MM-DD is what the input holds.
function shortDay(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// One line for the trigger: the range if there is one, otherwise the promise
// that the field is not narrowing anything.
function dateRangeLabel(dateFrom, dateTo) {
  if (dateFrom && dateTo) return `${shortDay(dateFrom)} → ${shortDay(dateTo)}`;
  if (dateFrom) return `From ${shortDay(dateFrom)}`;
  if (dateTo) return `Until ${shortDay(dateTo)}`;
  return 'Date range';
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

// Shared open/close behaviour for the two popovers: click outside or Escape.
function useDismiss(open, setOpen, rootRef) {
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
  }, [open, setOpen, rootRef]);
}

function NeighborhoodPicker({ selected, counts, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useDismiss(open, setOpen, rootRef);

  return (
    <div className="multi" ref={rootRef}>
      <button
        type="button"
        className={`select select--multi ${open ? 'is-open' : ''} ${
          selected.length ? 'is-active' : ''
        }`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Neighborhoods"
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

// From and To are one decision, so they share a single trigger instead of
// taking two slots in the row. The inputs keep their own labels, where there is
// room for them, and picking either one clears the quick preset.
function DateRangePicker({ dateFrom, dateTo, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useDismiss(open, setOpen, rootRef);
  const active = Boolean(dateFrom || dateTo);

  return (
    <div className="multi" ref={rootRef}>
      <button
        type="button"
        className={`select select--multi ${open ? 'is-open' : ''} ${active ? 'is-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Date range"
        onClick={() => setOpen((value) => !value)}
      >
        {dateRangeLabel(dateFrom, dateTo)}
      </button>

      {open && (
        <div className="multi__menu date-range">
          <div className="date-range__row">
            <label className="date-range__field">
              <span className="control__label">From</span>
              <input
                type="date"
                className="input"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => onChange({ dateFrom: e.target.value })}
              />
            </label>
            <label className="date-range__field">
              <span className="control__label">To</span>
              <input
                type="date"
                className="input"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => onChange({ dateTo: e.target.value })}
              />
            </label>
          </div>
          <div className="date-range__foot">
            <button
              type="button"
              className="multi__clear"
              disabled={!active}
              onClick={() => onChange({ dateFrom: '', dateTo: '' })}
            >
              Clear dates
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Two rows, no labels: the category chips scroll on one line and the four
// narrowing controls sit on the next, each showing its own state as its text.
// Sorting and the view switch live in the results strip below, next to the
// count they affect.
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
  counts,
  total,
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
          <NeighborhoodPicker
            selected={neighborhoods}
            counts={neighborhoodCounts}
            onToggle={onToggleNeighborhood}
            onClear={onClearNeighborhoods}
          />
        </div>

        <label className="control">
          <span className="sr-only">When</span>
          <select className="select" value={when} onChange={(e) => onWhenChange(e.target.value)}>
            {WHEN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="sr-only">Price</span>
          <select className="select" value={price} onChange={(e) => onPriceChange(e.target.value)}>
            {PRICE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="control">
          <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={onDateChange} />
        </div>

        <div className="feed__spacer" />

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
