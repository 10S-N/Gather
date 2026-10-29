import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PreferencesPicker from '../components/PreferencesPicker';
import RecommendationCard from '../components/RecommendationCard';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { useCommunityEvents } from '../hooks/useCommunityEvents';
import { usePreferences } from '../hooks/usePreferences';
import { useMyRsvps } from '../hooks/useRsvps';
import { EMPTY_PICKS, rankRecommendations } from '../utils/recommend.js';

const SKELETON_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];

function FeedSkeleton() {
  return (
    <div className="rec-grid" aria-busy="true" aria-label="Loading recommendations">
      {SKELETON_KEYS.map((key) => (
        <div className="rec-tile-skeleton" key={key}>
          <div className="skeleton skeleton--media rec-tile-skeleton__media" />
          <div className="rec-tile-skeleton__body">
            <div className="skeleton skeleton--line" style={{ width: '46%', margin: '0' }} />
            <div className="skeleton skeleton--line" style={{ width: '86%', height: 13, margin: '8px 0 0' }} />
            <div className="skeleton skeleton--line" style={{ width: '62%', margin: '8px 0 0' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PickChips({ picks }) {
  const entries = [
    ...picks.categories.map((name) => ({ key: `c:${name}`, label: name, kind: 'category' })),
    ...picks.neighborhoods.map((name) => ({ key: `n:${name}`, label: name, kind: 'neighborhood' })),
  ];
  if (!entries.length) return null;

  return (
    <div className="rec-picks">
      <span className="rec-picks__label">Your picks</span>
      <ul className="rec-picks__list">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`rec-pick${entry.kind === 'neighborhood' ? ' rec-pick--place' : ''}`}
          >
            {entry.kind === 'neighborhood' && <span aria-hidden="true">📍</span>}
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecommendedPage() {
  const { user } = useAuth();
  const { openLogin, openSignup } = useAuthModal();
  const community = useCommunityEvents();
  const { preferences, loaded: picksLoaded, save } = usePreferences(user);
  const { savedIds, pendingIds, toggle, error: rsvpError, clearError } = useMyRsvps(user);
  const [pickerOpen, setPickerOpen] = useState(false);

  const picks = preferences || EMPTY_PICKS;
  const pickCount = picks.categories.length + picks.neighborhoods.length;

  // `preferences` is a fresh object per profile snapshot; it only changes when
  // the picks are saved, so the feed does not re-rank on every render.
  const ranking = useMemo(
    () => rankRecommendations(community.events, preferences || EMPTY_PICKS),
    [community.events, preferences],
  );

  const matchedItems = ranking.items.filter((item) => item.matched);
  const restItems = ranking.items.filter((item) => !item.matched);

  const renderCard = (item) => (
    <RecommendationCard
      key={item.event.id}
      event={item.event}
      reason={item.reason}
      joined={savedIds.has(item.event.id)}
      pending={pendingIds.has(item.event.id)}
      onToggle={toggle}
      isHost={user?.uid === item.event.hostUid}
    />
  );

  return (
    <div className="rec-page">
      <div className="shell">
        <header className="rec-head">
          <div className="rec-head__copy">
            <span className="rec-head__eyebrow">For you</span>
            <h1>Recommended around Austin</h1>
            <p className="rec-head__lede">
              {!user
                ? 'Log in and pick a few interests to get a feed ranked for you. Until then, this is the whole board, soonest first.'
                : ranking.personalized
                  ? `${ranking.matchCount} ${ranking.matchCount === 1 ? 'event matches' : 'events match'} the ${pickCount} ${pickCount === 1 ? 'pick' : 'picks'} you made — the rest of the board follows below.`
                  : 'Pick a few categories and neighborhoods and this feed will rank itself around them. No picks yet, so everything is here, soonest first.'}
            </p>
          </div>

          {user ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setPickerOpen(true)}
            >
              {pickCount > 0 ? 'Edit picks' : 'Choose picks'}
            </button>
          ) : (
            <div className="rec-head__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={openLogin}>
                Log in
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={openSignup}>
                Sign up
              </button>
            </div>
          )}
        </header>

        {user && picksLoaded && pickCount > 0 && <PickChips picks={picks} />}

        {rsvpError && (
          <div className="alert alert--error" role="alert">
            <span>{rsvpError}</span>
            <button type="button" className="chip" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}

        {community.error && (
          <div className="alert alert--error" role="alert">
            {community.error}
          </div>
        )}

        {community.loading && <FeedSkeleton />}

        {!community.loading && community.events.length === 0 && !community.error && (
          <div className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">
              ✦
            </div>
            <h3>Nothing to recommend yet</h3>
            <p>
              Recommendations come from the community board. Once neighbors post events, they
              show up here ranked by your picks.
            </p>
            <div className="empty-state__actions">
              <Link to="/post-event" className="btn btn--primary">
                Post an event
              </Link>
              <Link to="/" className="btn btn--ghost">
                Browse the board
              </Link>
            </div>
          </div>
        )}

        {!community.loading && ranking.total > 0 && (
          <div className="rec-grid">
            {matchedItems.map(renderCard)}

            {matchedItems.length > 0 && restItems.length > 0 && (
              <div className="rec-divider">
                <span>{ranking.personalized ? 'The rest of the board' : 'Everything else happening'}</span>
              </div>
            )}

            {restItems.map(renderCard)}
          </div>
        )}
      </div>

      {pickerOpen && (
        <PreferencesPicker
          initial={preferences}
          onSave={save}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export default RecommendedPage;
