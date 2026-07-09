import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { mockEvents } from '../data/testevents';
import { useLiveEvents } from '../hooks/useLiveEvents';

const CACHE_TTL_MS = 60 * 60 * 1000;

// Merge live + mock, dropping any mock events whose fingerprint matches a
// live one. Mock events get a synthesized startAt and the 'Mock' source tag.
function mergeEvents(live, mock) {
  const currentYear = new Date().getFullYear();
  const seen = new Set(
    live.map(
      (e) => `${e.title}::${e.date}::${e.location}`.toLowerCase(),
    ),
  );
  const enrichedMocks = [];
  for (const ev of mock) {
    const key = `${ev.title}::${ev.date}::${ev.location}`.toLowerCase();
    if (seen.has(key)) continue;
    const startAt = mockDateToISO(ev.date, currentYear);
    enrichedMocks.push({ ...ev, startAt, source: 'Mock' });
  }
  return [...live, ...enrichedMocks];
}

function mockDateToISO(displayDate, year) {
  // Mock events come as "Thu, May 7"; bolt on the current year so the sort
  // can use a real timestamp.
  const t = Date.parse(`${displayDate} ${year}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function sortByStart(a, b) {
  // Push events without a real timestamp to the bottom.
  const av = a.startAt ? Date.parse(a.startAt) : Number.POSITIVE_INFINITY;
  const bv = b.startAt ? Date.parse(b.startAt) : Number.POSITIVE_INFINITY;
  return av - bv;
}

function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPrice, setSelectedPrice] = useState('All');

  // `now` ticks once a minute so the LIVE/STALE badge and "Updated X ago"
  // stay honest. Wrapped in setTimeout(0) for the initial tick so the setState
  // call doesn't cascade out of the effect body (lint rule).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const intervalId = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(intervalId);
    };
  }, []);

  const live = useLiveEvents({ enabled: true });
  const allEvents = useMemo(
    () => mergeEvents(live.events || [], mockEvents),
    [live.events],
  );

  const filteredEvents = allEvents.filter((event) => {
    const matchesCategory =
      selectedCategory === 'All' || event.category === selectedCategory;
    const matchesPrice =
      selectedPrice === 'All' ||
      (selectedPrice === 'Free' && event.price === 'Free') ||
      (selectedPrice === 'Paid' && event.price !== 'Free');
    return matchesCategory && matchesPrice;
  });

  const sortedEvents = [...filteredEvents].sort(sortByStart);

  const cacheFresh =
    Boolean(now) && Boolean(live.fetchedAt) && now - live.fetchedAt < CACHE_TTL_MS;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: '220px',
          backgroundColor: 'var(--sand)',
          padding: '1.5rem',
          borderRight: '1px solid var(--border)',
        }}
      >
        <h2 style={{ color: 'var(--earth)', fontSize: '20px', marginBottom: '1.5rem' }}>
          FILTERS
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={selectStyle}
            >
              <option value="All">All Categories</option>
              <option value="Academic">Academic</option>
              <option value="Community">Community</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Social">Social</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Price Option</label>
            <select
              value={selectedPrice}
              onChange={(e) => setSelectedPrice(e.target.value)}
              style={selectStyle}
            >
              <option value="All">All Prices</option>
              <option value="Free">Free Events</option>
              <option value="Paid">Paid Events</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Location Area</label>
            <select style={selectStyle} disabled>
              <option>All Austin Areas</option>
            </select>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1>FIND EVENTS NEAR YOU</h1>
          <p>Discover what's happening in your community.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <input
            type="text"
            placeholder="Search events, locations, or keywords..."
            style={{
              width: '100%',
              maxWidth: '600px',
              padding: '12px 20px',
              borderRadius: '25px',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '2px solid var(--rust)',
            paddingBottom: '10px',
            marginBottom: '2rem',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 'bold', color: 'var(--rust)' }}>
            {sortedEvents.length} EVENTS FOUND
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <SourceBadge sourcesActive={live.sourcesActive} cacheFresh={cacheFresh} />
            {live.fetchedAt && now > 0 && (
              <span style={{ color: 'var(--earth)', fontSize: '12px' }}>
                Updated {formatRelative(now, live.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={live.refresh}
              disabled={live.loading || live.refreshing}
              style={refreshBtnStyle}
              aria-label="Refresh events from online sources"
            >
              {live.refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          <span style={{ color: 'var(--earth)' }}>SORT: DATE (SOONEST)</span>
        </div>

        {!import.meta.env.VITE_TICKETMASTER_KEY && (
          <div style={noticeBoxStyle}>
            <strong>Live events are paused.</strong> Add{' '}
            <code>VITE_TICKETMASTER_KEY</code> to a <code>.env.local</code> file
            (sign up free at developer.ticketmaster.com) to pull real Austin
            events. Until then you're seeing curated sample events.
          </div>
        )}

        {live.error && <div style={errorBoxStyle}>{live.error}</div>}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {sortedEvents.map((event) => (
            <Link
              to={event.url && event.source !== 'Mock' ? event.url : `/event/${event.id}`}
              key={`${event.source}-${event.id}`}
              target={event.url && event.source !== 'Mock' ? '_blank' : undefined}
              rel={event.url && event.source !== 'Mock' ? 'noopener noreferrer' : undefined}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  borderRadius: '12px',
                  overflow: 'hidden',
                  backgroundColor: 'white',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                  border: '1px solid var(--border)',
                  transition: 'transform 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.transform = 'scale(1.02)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.transform = 'scale(1.0)')
                }
              >
                <div
                  style={{
                    height: '160px',
                    backgroundColor: 'var(--rust)',
                    backgroundImage: `url(${event.image})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />

                <div style={{ padding: '15px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '6px',
                    }}
                  >
                    <h3 style={{ fontSize: '18px', margin: 0, color: 'var(--navy)' }}>
                      {event.title}
                    </h3>
                    <span
                      title={event.source}
                      style={{
                        fontSize: '10px',
                        fontWeight: 'bold',
                        letterSpacing: '0.4px',
                        color: event.source === 'Ticketmaster' ? 'var(--sage)' : 'var(--earth)',
                        backgroundColor: 'var(--bg)',
                        padding: '2px 6px',
                        borderRadius: '8px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {event.source === 'Ticketmaster' ? 'LIVE' : event.source}
                    </span>
                  </div>
                  <p style={{ fontSize: '14px', margin: '0 0 10px 0', color: 'var(--earth)' }}>
                    {event.date} • {event.location}
                  </p>
                  <span
                    style={{
                      backgroundColor:
                        event.price === 'Free' ? 'var(--sage)' : 'var(--sand)',
                      color: 'var(--navy)',
                      padding: '4px 10px',
                      borderRadius: '15px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                  >
                    {event.price}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

function SourceBadge({ sourcesActive, cacheFresh }) {
  if (!sourcesActive?.length) return null;
  return (
    <span
      style={{
        backgroundColor: 'var(--sage)',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 'bold',
        letterSpacing: '0.4px',
      }}
      title={`Live data from: ${sourcesActive.join(', ')}`}
    >
      ● {cacheFresh ? 'LIVE' : 'STALE'}
    </span>
  );
}

function formatRelative(now, ts) {
  const diff = now - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

const labelStyle = {
  display: 'block',
  fontSize: '14px',
  fontWeight: '600',
  color: 'var(--earth)',
  marginBottom: '5px',
};

const selectStyle = {
  width: '100%',
  padding: '10px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  backgroundColor: '#fcfbfa',
  color: 'var(--earth)',
  fontSize: '14px',
  cursor: 'pointer',
};

const refreshBtnStyle = {
  background: 'white',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '6px 14px',
  borderRadius: '8px',
  fontWeight: '600',
  cursor: 'pointer',
  fontSize: '13px',
};

const noticeBoxStyle = {
  backgroundColor: 'var(--sand)',
  color: 'var(--earth)',
  padding: '12px 16px',
  borderRadius: '10px',
  border: '1px dashed var(--earth)',
  fontSize: '13px',
  marginBottom: '1.5rem',
};

const errorBoxStyle = {
  backgroundColor: '#fdecea',
  color: '#a0322b',
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '13px',
  marginBottom: '1.5rem',
};

// Suppress unused-warning on the `loading` flag — drive it through the
// button-disabled state above but keep the value readable for future UI.
void 0;

export default HomePage;
