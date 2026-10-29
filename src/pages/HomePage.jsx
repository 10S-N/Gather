import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EventCard from '../components/EventCard';
import EventFilters from '../components/EventFilters';
import ResultsBar from '../components/ResultsBar';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { useCommunityEvents } from '../hooks/useCommunityEvents';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useMyRsvps } from '../hooks/useRsvps';
import {
  DEFAULT_SORT,
  filterEvents,
  formatEventDate,
  isPastEvent,
  normalizeExternalEvent,
  sortEvents,
} from '../utils/events';

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
  // Multi-select: an empty list means "every neighborhood".
  const [neighborhoods, setNeighborhoods] = useState([]);
  const [when, setWhen] = useState('all');
  const [price, setPrice] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [showCityWide, setShowCityWide] = useState(false);

  // Only hit the ticketing API once the section is opened — the community
  // board above never depends on it.
  const live = useLiveEvents({ enabled: showCityWide });

  // Everything matching the search/neighborhood/date/price constraints, before
  // the category chip narrows it. Powers the per-chip counts, so a chip that
  // would return nothing is visible rather than a surprise.
  const constrained = useMemo(
    () =>
      filterEvents(community.events, {
        neighborhoods,
        when,
        query,
        price,
        dateFrom,
        dateTo,
      }),
    [community.events, neighborhoods, when, query, price, dateFrom, dateTo],
  );

  // Neighborhood options answer "what else could I pick?", so they are counted
  // with every other filter applied *except* the neighborhood one — otherwise
  // picking Downtown would zero out every other option and strand the picker.
  const neighborhoodCounts = useMemo(() => {
    const next = {};
    for (const event of filterEvents(community.events, {
      category,
      when,
      query,
      price,
      dateFrom,
      dateTo,
    })) {
      const name = event.neighborhood || '';
      if (name) next[name] = (next[name] || 0) + 1;
    }
    return next;
  }, [community.events, category, when, query, price, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const next = {};
    for (const event of constrained) {
      next[event.category] = (next[event.category] || 0) + 1;
    }
    return next;
  }, [constrained]);

  const visibleEvents = useMemo(() => {
    const narrowed = constrained.filter((event) => category === 'All' || event.category === category);
    return sortEvents(narrowed, sort);
  }, [constrained, category, sort]);

  const stats = useMemo(() => {
    const upcoming = community.events.filter((event) => !isPastEvent(event));
    const hoods = new Set(upcoming.map((event) => event.neighborhood).filter(Boolean));
    const nextEvent = sortEvents(upcoming)[0];
    return {
      upcoming: upcoming.length,
      neighborhoods: hoods.size,
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
    category !== 'All' ||
    neighborhoods.length > 0 ||
    sort !== DEFAULT_SORT ||
    when !== 'all' ||
    price !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    query.trim() !== '';

  // A quick-date preset and a custom range are two ways to say the same thing,
  // so picking one clears the other instead of silently intersecting them.
  const changeWhen = (value) => {
    setWhen(value);
    if (value !== 'all') {
      setDateFrom('');
      setDateTo('');
    }
  };

  const changeDates = (patch) => {
    if ('dateFrom' in patch) setDateFrom(patch.dateFrom);
    if ('dateTo' in patch) setDateTo(patch.dateTo);
    setWhen('all');
  };

  const toggleNeighborhood = (name) => {
    setNeighborhoods((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  };

  const resetFilters = () => {
    setCategory('All');
    setNeighborhoods([]);
    setWhen('all');
    setPrice('all');
    setDateFrom('');
    setDateTo('');
    setSort(DEFAULT_SORT);
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
            neighborhoods={neighborhoods}
            neighborhoodCounts={neighborhoodCounts}
            onToggleNeighborhood={toggleNeighborhood}
            onClearNeighborhoods={() => setNeighborhoods([])}
            when={when}
            onWhenChange={changeWhen}
            price={price}
            onPriceChange={setPrice}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateChange={changeDates}
            counts={counts}
            total={constrained.length}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
          />

          <ResultsBar
            count={visibleEvents.length}
            query={query}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
          />

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
