import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EventCard from '../components/EventCard';
import EventFilters from '../components/EventFilters';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { useCommunityEvents } from '../hooks/useCommunityEvents';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useMyRsvps } from '../hooks/useRsvps';
import { formatEventDate, filterEvents, isPastEvent, normalizeExternalEvent, sortEvents } from '../utils/events';

// Leaflet (and its CSS) only loads when someone actually opens the map.
const MapView = lazy(() => import('../components/MapView'));

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'];

function EventGridSkeleton() {
  return (
    <div className="event-grid" aria-hidden="true">
      {SKELETON_KEYS.map((key) => (
        <div className="skeleton-card" key={key}>
          <div className="skeleton skeleton--media" />
          <div className="skeleton skeleton--line" style={{ width: '38%' }} />
          <div className="skeleton skeleton--line" style={{ width: '82%', height: 18 }} />
          <div className="skeleton skeleton--line" style={{ width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

function HomePage() {
  const { user } = useAuth();
  const { openSignup } = useAuthModal();
  const community = useCommunityEvents();
  const { savedIds, pendingIds, toggle, error: rsvpError, clearError } = useMyRsvps(user);

  const [category, setCategory] = useState('All');
  const [neighborhood, setNeighborhood] = useState('All');
  const [when, setWhen] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [showCityWide, setShowCityWide] = useState(false);

  // Only hit the ticketing API once the section is opened — the community
  // board above never depends on it.
  const live = useLiveEvents({ enabled: showCityWide });

  // Everything matching the search/neighborhood/date constraints, before the
  // category chip narrows it. Powers the per-chip counts.
  const baseEvents = useMemo(
    () => filterEvents(community.events, { neighborhood, when, query }),
    [community.events, neighborhood, when, query],
  );

  const counts = useMemo(() => {
    const next = {};
    for (const event of baseEvents) {
      next[event.category] = (next[event.category] || 0) + 1;
    }
    return next;
  }, [baseEvents]);

  const visibleEvents = useMemo(() => {
    const narrowed = baseEvents.filter((event) => category === 'All' || event.category === category);
    return sortEvents(narrowed);
  }, [baseEvents, category]);

  const stats = useMemo(() => {
    const upcoming = community.events.filter((event) => !isPastEvent(event));
    const neighborhoods = new Set(upcoming.map((event) => event.neighborhood).filter(Boolean));
    const nextEvent = sortEvents(upcoming)[0];
    return {
      upcoming: upcoming.length,
      neighborhoods: neighborhoods.size,
      next: nextEvent ? formatEventDate(nextEvent.startAt) : '—',
    };
  }, [community.events]);

  const cityWide = useMemo(() => {
    const normalized = live.events.map(normalizeExternalEvent);
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? normalized.filter((event) =>
          [event.title, event.location, event.category]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : normalized;
    return filtered.slice(0, 8);
  }, [live.events, query]);

  const hasActiveFilters =
    category !== 'All' || neighborhood !== 'All' || when !== 'all' || query.trim() !== '';

  const resetFilters = () => {
    setCategory('All');
    setNeighborhood('All');
    setWhen('all');
    setQuery('');
  };

  return (
    <>
      <section className="hero">
        <div className="shell">
          <div className="hero__inner">
            <span className="hero__eyebrow">Austin · community-run</span>
            <h1>Find your people, three blocks away.</h1>
            <p className="hero__lede">
              House shows, basement art walks, pop-ups, workshops, and neighborhood meetups —
              posted by the people who live here, plus a few curated finds from Austin's indie
              calendars.
            </p>

            <form
              className="hero__search"
              role="search"
              onSubmit={(e) => e.preventDefault()}
            >
              <span className="hero__search-icon" aria-hidden="true">
                🔍
              </span>
              <label className="sr-only" htmlFor="event-search">
                Search events
              </label>
              <input
                id="event-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Try “vinyl”, “Riverside”, or “workshop”…"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="hero__clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </form>

            <div className="hero__stats">
              <div className="hero__stat">
                <strong>{stats.upcoming}</strong>
                <span>Upcoming</span>
              </div>
              <div className="hero__stat">
                <strong>{stats.neighborhoods}</strong>
                <span>Neighborhoods</span>
              </div>
              <div className="hero__stat">
                <strong>{stats.next}</strong>
                <span>Next up</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="feed">
        <div className="shell">
          <EventFilters
            category={category}
            onCategoryChange={setCategory}
            neighborhood={neighborhood}
            onNeighborhoodChange={setNeighborhood}
            when={when}
            onWhenChange={setWhen}
            counts={counts}
            total={baseEvents.length}
            view={view}
            onViewChange={setView}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
          />

          <div className="results-bar">
            <span className="results-bar__count">
              {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
              {query.trim() ? ` for “${query.trim()}”` : ''}
            </span>
            <span className="results-bar__meta">
              {neighborhood !== 'All' ? `${neighborhood} · ` : ''}
              {view === 'map' ? 'Map view' : 'Sorted by soonest'}
            </span>
          </div>

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

          {community.loading && <EventGridSkeleton />}

          {!community.loading && community.events.length === 0 && !community.error && (
            <div className="empty-state">
              <div className="empty-state__icon" aria-hidden="true">
                📌
              </div>
              <h3>No events on the board yet</h3>
              <p>
                Gather is built from posts by neighbors, plus a few curated finds from local
                calendars. Be the first to put something on the map.
              </p>
              <div className="empty-state__actions">
                {user ? (
                  <Link to="/post-event" className="btn btn--primary">
                    Post the first event
                  </Link>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={openSignup}>
                    Create an account to post
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setShowCityWide(true)}
                >
                  See city-wide listings
                </button>
              </div>
            </div>
          )}

          {!community.loading && visibleEvents.length === 0 && community.events.length > 0 && (
            <div className="empty-state">
              <div className="empty-state__icon" aria-hidden="true">
                🔎
              </div>
              <h3>Nothing matches those filters</h3>
              <p>
                Try a different category, widen the date range, or clear the search to see
                everything happening around Austin.
              </p>
              <div className="empty-state__actions">
                <button type="button" className="btn btn--primary" onClick={resetFilters}>
                  Clear filters
                </button>
              </div>
            </div>
          )}

          {!community.loading && visibleEvents.length > 0 && view === 'grid' && (
            <div className="event-grid">
              {visibleEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  joined={savedIds.has(event.id)}
                  pending={pendingIds.has(event.id)}
                  onToggle={toggle}
                  isHost={user?.uid === event.hostUid}
                />
              ))}
            </div>
          )}

          {view === 'map' && !community.loading && visibleEvents.length > 0 && (
            <Suspense
              fallback={
                <div className="map-shell" aria-label="Loading map">
                  <div className="skeleton" style={{ height: '100%', borderRadius: 0 }} />
                </div>
              }
            >
              <MapView events={visibleEvents} />
            </Suspense>
          )}

          <div className="section-head">
            <div>
              <h2>City-wide listings</h2>
              <p>
                Bigger venues still post through public ticketing feeds. They&rsquo;re here for
                context — RSVPs and community posts above are what Gather is for.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowCityWide((open) => !open)}
              aria-expanded={showCityWide}
            >
              {showCityWide ? 'Hide listings' : 'Show listings'}
            </button>
          </div>

          {showCityWide && (
            <>
              {!import.meta.env.VITE_TICKETMASTER_KEY && (
                <div className="alert alert--info">
                  <span>
                    Live listings need a free Ticketmaster Discovery key in{' '}
                    <code>VITE_TICKETMASTER_KEY</code> (see <code>.env.local</code>).
                  </span>
                </div>
              )}

              {live.error && (
                <div className="alert alert--error" role="alert">
                  {live.error}
                </div>
              )}

              {live.refreshing && <p className="map-note">Refreshing city-wide listings…</p>}

              {cityWide.length > 0 ? (
                <div className="event-grid" style={{ marginTop: 0 }}>
                  {cityWide.map((event) => (
                    <EventCard key={`${event.source}-${event.id}`} event={event} />
                  ))}
                </div>
              ) : (
                <p className="map-note" style={{ marginTop: 0 }}>
                  No city-wide listings to show right now.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

export default HomePage;
