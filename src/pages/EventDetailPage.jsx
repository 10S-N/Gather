import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import RsvpButton from '../components/RsvpButton';
import { mockEvents } from '../data/testevents';
import { useAuth } from '../contexts/useAuth';
import { useCommunityEvent } from '../hooks/useEvent';
import { useMyRsvps } from '../hooks/useRsvps';
import { deleteEvent } from '../services/events';
import { readCache } from '../services/eventSources';
import { formatLongDate, formatWhen, normalizeExternalEvent } from '../utils/events';

// Older links (sample data, cached Ticketmaster listings) still resolve so a
// shared URL never dead-ends.
function findLegacyEvent(id, fromState) {
  if (fromState?.id === id) return normalizeExternalEvent(fromState);

  const mock = mockEvents.find((event) => event.id === id);
  if (mock) return normalizeExternalEvent({ ...mock, source: 'Mock' });

  const cached = readCache();
  const live = cached?.events?.find((event) => event.id === id);
  return live ? normalizeExternalEvent(live) : null;
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

function EventDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const legacy = useMemo(
    () => findLegacyEvent(id, location.state?.event),
    [id, location.state],
  );

  const { event: communityEvent, loading, error } = useCommunityEvent(id);
  const { savedIds, pendingIds, toggle, error: rsvpError } = useMyRsvps(user);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const event = communityEvent || legacy;
  const isCommunity = event?.source === 'community';
  const isCurated = event?.source === 'curated';
  const isHost = Boolean(isCommunity && user && event.hostUid === user.uid);
  const joined = Boolean(event && savedIds.has(event.id));
  const going = event?.attendeeCount ?? 0;
  const capacity = event?.capacity ?? null;
  const capacityPercent = capacity ? Math.min(100, Math.round((going / capacity) * 100)) : 0;

  const handleDelete = async () => {
    if (!event) return;
    const confirmed = window.confirm(
      `Delete “${event.title}”? RSVPs will be removed from the board for everyone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError('');
    try {
      await deleteEvent(event.id);
      navigate('/profile');
    } catch (err) {
      setDeleteError(
        err?.message?.replace('Firebase:', '').trim() || 'Could not delete this event.',
      );
      setDeleting(false);
    }
  };

  if (!event && loading && !legacy) {
    return (
      <div className="detail">
        <div className="shell">
          <Link className="detail__back" to="/">
            ← All events
          </Link>
          <div className="detail__grid" aria-busy="true">
            <div className="skeleton" style={{ minHeight: 320 }} />
            <div>
              <div className="skeleton skeleton--line" style={{ width: '35%' }} />
              <div className="skeleton skeleton--line" style={{ width: '85%', height: 30 }} />
              <div className="skeleton skeleton--line" style={{ width: '60%' }} />
              <div className="skeleton skeleton--line" style={{ width: '90%' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="detail">
        <div className="shell">
          <div className="empty-state" style={{ maxWidth: 620, margin: '40px auto 0' }}>
            <div className="empty-state__icon" aria-hidden="true">
              🧭
            </div>
            <h3>Event not found</h3>
            <p>
              This event may have ended, been taken down by its host, or the link is off by a
              character.
            </p>
            {error && <p style={{ marginTop: 10, color: '#a0322b' }}>{error}</p>}
            <div className="empty-state__actions">
              <Link to="/" className="btn btn--primary">
                Back to the board
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const when = formatWhen(event);
  const longDate = event.startAt ? formatLongDate(event.startAt) : event.date;

  return (
    <div className="detail">
      <div className="shell">
        <Link className="detail__back" to="/">
          ← All events
        </Link>

        <div className="detail__grid">
          <div
            className="detail__media"
            style={event.image ? { backgroundImage: `url(${event.image})` } : undefined}
            role="img"
            aria-label={event.image ? `${event.title} cover image` : 'Event cover placeholder'}
          />

          <div className="detail__panel">
            <div className="detail__badges">
              <span className="badge badge--sand">{event.category}</span>
              {event.price && <span className="badge badge--sage">{event.price}</span>}
              {isCurated && (
                <span className="badge badge--sand" title="Synced from a public local calendar">
                  ✦ Curated · {event.sourceLabel}
                </span>
              )}
              {isCommunity && isHost && <span className="badge">Your event</span>}
            </div>

            <h1 className="detail__title">{event.title}</h1>

            <div className="detail__meta">
              <div className="detail__meta-item">
                <span aria-hidden="true">🗓️</span>
                <span>
                  {longDate || when}
                  {event.startAt && (
                    <>
                      {' · '}
                      {new Date(event.startAt).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </>
                  )}
                </span>
              </div>
              <div className="detail__meta-item">
                <span aria-hidden="true">📍</span>
                <span>
                  {event.neighborhood || 'Austin'}
                  {event.address ? ` — ${event.address}` : ''}
                </span>
              </div>
            </div>

            {event.tags?.length > 0 && (
              <ul className="detail__tags" aria-label="Tags">
                {event.tags.map((tag) => (
                  <li className="tag" key={tag}>
                    #{tag}
                  </li>
                ))}
              </ul>
            )}

            <p className="detail__description">
              {event.description || 'The host hasn’t added more details yet.'}
            </p>

            {isCurated && (
              <div className="host-card">
                <span className="host-card__avatar" aria-hidden="true">
                  ✦
                </span>
                <div>
                  <div className="host-card__name">Curated from {event.sourceLabel}</div>
                  <div className="host-card__meta">
                    Imported automatically from a public local calendar. RSVPs are handled on
                    the original listing.
                  </div>
                </div>
              </div>
            )}

            {isCommunity && (
              <div className="host-card">
                {event.hostPhotoURL ? (
                  <img
                    className="host-card__avatar"
                    src={event.hostPhotoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="host-card__avatar" aria-hidden="true">
                    {initialsOf(event.hostName)}
                  </span>
                )}
                <div>
                  <div className="host-card__name">{event.hostName}</div>
                  <div className="host-card__meta">
                    {isHost ? 'You’re hosting this one' : 'Hosting on Gather'}
                  </div>
                </div>
              </div>
            )}

            <div className="detail__actions">
              <div className="detail__price-row">
                <span className="detail__price-label">Admission</span>
                <span className="detail__price">
                  {/* A curated feed may not publish pricing; never claim "Free". */}
                  {event.price || (isCurated ? 'See listing' : 'Free')}
                </span>
              </div>

              {isCommunity ? (
                <>
                  {capacity && (
                    <div className="capacity">
                      <div className="capacity__label">
                        <span>{going} going</span>
                        <span>
                          {capacity} spots ·{' '}
                          {capacityPercent >= 100 ? 'full' : `${capacityPercent}% full`}
                        </span>
                      </div>
                      <div
                        className="capacity__track"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={capacity}
                        aria-valuenow={Math.min(going, capacity)}
                        aria-label="RSVP capacity"
                      >
                        <div className="capacity__bar" style={{ width: `${capacityPercent}%` }} />
                      </div>
                    </div>
                  )}

                  {!capacity && (
                    <p className="host-card__meta">
                      {going} {going === 1 ? 'neighbor is' : 'neighbors are'} going
                    </p>
                  )}

                  <RsvpButton
                    event={event}
                    joined={joined}
                    pending={pendingIds.has(event.id)}
                    onToggle={toggle}
                    isHost={isHost}
                  />

                  {event.rsvpUrl && (
                    <a
                      className="detail__secondary-link"
                      href={event.rsvpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      The host also has an external RSVP page ↗
                    </a>
                  )}

                  {rsvpError && (
                    <div className="alert alert--error" role="alert">
                      {rsvpError}
                    </div>
                  )}

                  {!user && (
                    <p className="host-card__meta" style={{ textAlign: 'center' }}>
                      You&rsquo;ll be asked to sign in before your RSVP is saved.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {event.url ? (
                    <a
                      className="btn btn--dark btn--block"
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {isCurated ? 'View the original listing ↗' : 'Get tickets on Ticketmaster ↗'}
                    </a>
                  ) : (
                    <p className="form-note">
                      This is a sample listing kept for reference. Community events have live RSVPs.
                    </p>
                  )}
                  <p className="host-card__meta" style={{ textAlign: 'center' }}>
                    {isCurated
                      ? 'Curated listing · RSVPs and updates live on the original calendar.'
                      : 'External listing · RSVPs are handled by the original venue.'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {isHost && (
          <div className="host-tools">
            <Link to={`/post-event?edit=${event.id}`} className="btn btn--ghost btn--sm">
              Edit event
            </Link>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete event'}
            </button>
          </div>
        )}

        {deleteError && (
          <div className="alert alert--error" role="alert">
            {deleteError}
          </div>
        )}
      </div>
    </div>
  );
}

export default EventDetailPage;
