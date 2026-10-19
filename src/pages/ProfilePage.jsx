import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EventCard from '../components/EventCard';
import EditProfileModal from '../components/EditProfileModal';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { useHostedEvents } from '../hooks/useHostedEvents';
import { useMyRsvps } from '../hooks/useRsvps';
import { fetchEventsByIds } from '../services/events';
import { subscribeUserProfile } from '../services/userProfile';
import { normalizeCommunityEvent, sortEvents } from '../utils/events';

const TABS = [
  { id: 'going', label: 'Going' },
  { id: 'hosting', label: 'Hosting' },
  { id: 'account', label: 'Account' },
];

function formatProvider(providerId) {
  if (!providerId) return 'Unknown';
  const known = {
    password: 'Email & password',
    'google.com': 'Google',
    'github.com': 'GitHub',
    'facebook.com': 'Facebook',
    'apple.com': 'Apple',
    'twitter.com': 'Twitter',
    phone: 'Phone',
  };
  return known[providerId] || providerId;
}

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const { openLogin, openSignup } = useAuthModal();
  const [coverPhotoURL, setCoverPhotoURL] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState('going');

  const { savedIds, pendingIds, toggle, error: rsvpError } = useMyRsvps(user);
  const hosted = useHostedEvents(user);

  // Live-subscribe to the user's Firestore doc so the cover photo refreshes
  // immediately after the edit modal saves.
  useEffect(() => {
    if (!user) return undefined;
    const unsub = subscribeUserProfile(user.uid, (data, err) => {
      if (err) {
        setCoverPhotoURL(null);
        return;
      }
      setCoverPhotoURL(data?.coverPhotoURL || null);
    });
    return unsub;
  }, [user]);

  // RSVP ids -> full event docs. Tagged with the id-set key so a stale fetch
  // can never overwrite a newer result.
  const savedKey = useMemo(() => [...savedIds].sort().join('|'), [savedIds]);
  const [goingState, setGoingState] = useState({ key: '', events: [], error: null });

  useEffect(() => {
    if (!user || !savedKey) return undefined;
    let cancelled = false;

    fetchEventsByIds(savedKey.split('|'))
      .then((rows) => {
        if (cancelled) return;
        setGoingState({
          key: savedKey,
          events: sortEvents(rows.map(({ id, ...data }) => normalizeCommunityEvent(id, data))),
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setGoingState({
          key: savedKey,
          events: [],
          error: err?.message?.replace('Firebase:', '').trim() || 'Could not load your RSVPs.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [user, savedKey]);

  const goingReady = goingState.key === savedKey;
  const goingEvents = savedKey ? (goingReady ? goingState.events : []) : [];
  const goingLoading = Boolean(savedKey) && !goingReady;

  if (loading) {
    return (
      <div className="profile">
        <div className="shell">
          <p className="map-note">Loading your profile…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="profile">
        <div className="shell">
          <div className="empty-state" style={{ maxWidth: 560, margin: '40px auto 0' }}>
            <div className="empty-state__icon" aria-hidden="true">
              👋
            </div>
            <h3>Sign in to see your events</h3>
            <p>
              Your profile keeps the events you&rsquo;re going to and the ones you&rsquo;ve posted
              in one place — no feed, no noise.
            </p>
            <div className="empty-state__actions">
              <button type="button" className="btn btn--primary" onClick={openSignup}>
                Create an account
              </button>
              <button type="button" className="btn btn--ghost" onClick={openLogin}>
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayName =
    user.displayName || (user.email ? user.email.split('@')[0] : user.phoneNumber || 'Gather user');
  const providerLabel = formatProvider(user.providerData?.[0]?.providerId);
  const memberSince = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : '—';

  const handleSignOut = () => {
    if (window.confirm('Sign out of Gather? You can always sign back in.')) {
      signOut();
    }
  };

  const renderCard = (event, { isHost = false } = {}) => (
    <EventCard
      key={event.id}
      event={event}
      joined={savedIds.has(event.id)}
      pending={pendingIds.has(event.id)}
      onToggle={toggle}
      isHost={isHost}
    />
  );

  return (
    <div className="profile">
      <div className="shell">
        <div className="profile-card">
          <div
            className={`profile-cover${coverPhotoURL ? ' has-image' : ''}`}
            style={
              coverPhotoURL ? { '--cover-url': `url(${coverPhotoURL})` } : undefined
            }
            aria-hidden="true"
          />

          <div className="profile-avatar-row">
            {user.photoURL ? (
              <img
                className="profile-avatar"
                src={user.photoURL}
                alt={`${displayName}'s profile picture`}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="profile-avatar" aria-hidden="true">
                {initialsOf(displayName)}
              </div>
            )}

            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditOpen(true)}>
              Edit profile
            </button>
          </div>

          <div className="profile-head">
            <h1 className="profile-name">{displayName}</h1>
            <p className="profile-email">{user.email || 'Signed in by phone'}</p>

            <div className="profile-stats">
              <div className="profile-stat">
                <strong>{hosted.events.length}</strong>
                <span>Hosting</span>
              </div>
              <div className="profile-stat">
                <strong>{savedIds.size}</strong>
                <span>Going</span>
              </div>
              <div className="profile-stat">
                <strong>{memberSince}</strong>
                <span>On Gather since</span>
              </div>
            </div>
          </div>

          <div className="profile-body">
            <div className="tabs" role="tablist" aria-label="Profile sections">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`panel-${item.id}`}
                  className={`tab${tab === item.id ? ' is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === 'going' && savedIds.size > 0 && ` (${savedIds.size})`}
                  {item.id === 'hosting' && hosted.events.length > 0 && ` (${hosted.events.length})`}
                </button>
              ))}
            </div>

            {rsvpError && (
              <div className="alert alert--error" role="alert">
                {rsvpError}
              </div>
            )}

            <div
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
              style={{ marginTop: 20 }}
            >
              {tab === 'going' && (
                <>
                  {goingLoading && <p className="map-note">Loading your RSVPs…</p>}
                  {goingState.error && goingReady && (
                    <div className="alert alert--error" role="alert">
                      {goingState.error}
                    </div>
                  )}
                  {!goingLoading && goingEvents.length > 0 && (
                    <div className="event-grid" style={{ marginTop: 0 }}>
                      {goingEvents.map((event) => renderCard(event))}
                    </div>
                  )}
                  {!goingLoading && goingEvents.length === 0 && !goingState.error && (
                    <div className="empty-state" style={{ marginTop: 0 }}>
                      <div className="empty-state__icon" aria-hidden="true">
                        ♡
                      </div>
                      <h3>No RSVPs yet</h3>
                      <p>
                        Tap “Interested” on anything in the feed and it lands here, with the details
                        you need when the day comes.
                      </p>
                      <div className="empty-state__actions">
                        <Link to="/" className="btn btn--primary">
                          Find something nearby
                        </Link>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'hosting' && (
                <>
                  {hosted.loading && <p className="map-note">Loading your events…</p>}
                  {hosted.error && (
                    <div className="alert alert--error" role="alert">
                      {hosted.error}
                    </div>
                  )}
                  {!hosted.loading && hosted.events.length > 0 && (
                    <div className="event-grid" style={{ marginTop: 0 }}>
                      {hosted.events.map((event) => renderCard(event, { isHost: true }))}
                    </div>
                  )}
                  {!hosted.loading && hosted.events.length === 0 && !hosted.error && (
                    <div className="empty-state" style={{ marginTop: 0 }}>
                      <div className="empty-state__icon" aria-hidden="true">
                        ✍️
                      </div>
                      <h3>Nothing hosted yet</h3>
                      <p>
                        Hosting a show, a class, a swap, or a cleanup? Post it and it appears on the
                        board for every neighbor browsing Gather.
                      </p>
                      <div className="empty-state__actions">
                        <Link to="/post-event" className="btn btn--primary">
                          Post an event
                        </Link>
                      </div>
                    </div>
                  )}
                  {hosted.events.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <Link to="/post-event" className="btn btn--ghost btn--sm">
                        + Post another event
                      </Link>
                    </div>
                  )}
                </>
              )}

              {tab === 'account' && (
                <>
                  <div className="account-row">
                    <span className="account-row__label">Email address</span>
                    <div className="account-row__value">{user.email || '— (signed in by phone)'}</div>
                  </div>

                  <div className="account-row">
                    <span className="account-row__label">Email verified</span>
                    <div
                      className="account-row__value"
                      style={{
                        color:
                          !user.email
                            ? 'var(--earth)'
                            : user.emailVerified
                              ? '#5a6420'
                              : 'var(--rust)',
                      }}
                    >
                      {!user.email
                        ? 'N/A'
                        : user.emailVerified
                          ? 'Verified ✓'
                          : 'Not yet — check your inbox'}
                    </div>
                  </div>

                  <div className="account-row">
                    <span className="account-row__label">Sign-in method</span>
                    <div className="account-row__value">{providerLabel}</div>
                  </div>

                  <div className="account-row">
                    <span className="account-row__label">Display name</span>
                    <div className="account-row__value">{user.displayName || '—'}</div>
                  </div>

                  <div className="account-row">
                    <span className="account-row__label">User ID</span>
                    <div
                      className="account-row__value"
                      style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                    >
                      {user.uid}
                    </div>
                  </div>

                  <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mounted only while open so the form always starts from current values. */}
      {editOpen && (
        <EditProfileModal
          onClose={() => setEditOpen(false)}
          currentCoverURL={coverPhotoURL}
        />
      )}
    </div>
  );
}

export default ProfilePage;
