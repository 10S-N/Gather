import { useEffect, useState } from 'react';
import { CATEGORIES, NEIGHBORHOODS } from '../data/neighborhoods';
import { normalizePicks } from '../utils/recommend.js';

// Multi-select picker for the "For you" feed. Used twice: automatically after
// a first login (mode="onboarding") and from the Recommended page to change
// your mind later (mode="edit"). Mounted only while open, so initializers pick
// up the current picks without a reset effect.
function PreferencesPicker({ initial, mode = 'edit', onSave, onClose }) {
  const [categories, setCategories] = useState(() => normalizePicks(initial).categories);
  const [neighborhoods, setNeighborhoods] = useState(() => normalizePicks(initial).neighborhoods);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (busy) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggle = (setter, value) => {
    setter((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  };

  const nothingPicked = categories.length === 0 && neighborhoods.length === 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (nothingPicked) {
      setError('Pick at least one category or neighborhood.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSave({ categories, neighborhoods });
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save your picks. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="picker-backdrop" onClick={busy ? undefined : onClose}>
      <form
        className="picker"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="picks-title"
      >
        <button
          type="button"
          className="picker__close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>

        <h2 className="picker__title" id="picks-title">
          {mode === 'onboarding' ? 'What are you into?' : 'Your picks'}
        </h2>
        <p className="picker__lede">
          Choose a few categories and neighborhoods. Your Recommended page ranks the board by
          them — pick as many or as few as you like, and change them any time.
        </p>

        <fieldset className="picker__section">
          <legend className="picker__label">
            Categories {categories.length > 0 && <span>{categories.length} picked</span>}
          </legend>
          <div className="picker__chips">
            {CATEGORIES.map((name) => {
              const active = categories.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggle(setCategories, name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="picker__section">
          <legend className="picker__label">
            Neighborhoods {neighborhoods.length > 0 && <span>{neighborhoods.length} picked</span>}
          </legend>
          <div className="picker__chips">
            {NEIGHBORHOODS.map(({ name }) => {
              const active = neighborhoods.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggle(setNeighborhoods, name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <div className="picker__error" role="alert">
            {error}
          </div>
        )}

        <div className="picker__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
            {mode === 'onboarding' ? 'Skip for now' : 'Cancel'}
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={busy || nothingPicked}
          >
            {busy ? 'Saving…' : 'Save picks'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PreferencesPicker;
