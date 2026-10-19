import { Link } from 'react-router-dom';
import RsvpButton from './RsvpButton';
import { formatWhen } from '../utils/events';

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function sourceLabel(event) {
  if (event.source === 'curated') return event.sourceLabel || 'Local calendar';
  if (event.source === 'ticketmaster') return 'Ticketmaster listing';
  if (event.source === 'sample') return 'Sample event';
  return 'Hosted by a neighbor';
}

function EventCard({ event, joined = false, onToggle, pending = false, isHost = false }) {
  const when = formatWhen(event);
  const place = event.neighborhood || event.location || 'Austin, TX';
  const going = event.attendeeCount;
  const capacity = event.capacity;
  const isCommunity = event.source === 'community';
  const isCurated = event.source === 'curated';

  // Subtle provenance label: neighbors need to know at a glance whether a
  // person or an automated calendar import is behind a listing.
  const origin = isCommunity
    ? { text: 'Community', title: 'Posted by a neighbor', className: 'badge--origin' }
    : isCurated
      ? {
          text: 'Curated',
          title: `Synced from ${sourceLabel(event)}`,
          className: 'badge--origin badge--curated',
        }
      : { text: 'External', title: 'Listing from a ticketing feed', className: 'badge--origin' };

  return (
    <article className="card">
      <div
        className="card__media"
        aria-hidden="true"
        style={event.image ? { backgroundImage: `url(${event.image})` } : undefined}
      >
        <div className="card__badges">
          <div className="card__badge-group">
            <span className="badge">{event.category}</span>
            {event.price && (
              <span className={`badge ${event.price === 'Free' ? 'badge--sage' : 'badge--sand'}`}>
                {event.price}
              </span>
            )}
          </div>
          <span className={origin.className} title={origin.title}>
            {isCurated && <span aria-hidden="true">✦</span>}
            {origin.text}
          </span>
        </div>
      </div>

      <div className="card__body">
        <p className="card__date">{when}</p>
        <h3 className="card__title">
          <Link to={`/event/${event.id}`} state={{ event }}>
            {event.title}
          </Link>
        </h3>
        <p className="card__location">
          <span aria-hidden="true">📍</span> {place}
        </p>

        {event.tags?.length > 0 && (
          <ul className="tag-list" aria-label="Tags">
            {event.tags.slice(0, 4).map((tag) => (
              <li className="tag" key={tag}>
                #{tag}
              </li>
            ))}
          </ul>
        )}

        <div className="card__footer">
          <div className="card__host">
            {isCommunity && event.hostPhotoURL ? (
              <img
                className="avatar"
                src={event.hostPhotoURL}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <span className="avatar avatar--initials" aria-hidden="true">
                {isCommunity ? initialsOf(event.hostName) : isCurated ? '✦' : '🎟'}
              </span>
            )}
            <span>{event.hostName || sourceLabel(event)}</span>
          </div>

          {isCommunity && (
            <span className="card__going">
              {going ?? 0} going{capacity ? ` / ${capacity}` : ''}
            </span>
          )}
          {/* Curated cards already name their source next to the avatar, so the
              right slot is reserved for the ticketing-feed listings. */}
          {!isCommunity && !isCurated && (
            <span className="card__going card__source">External</span>
          )}
        </div>

        <div className="card__actions">
          <RsvpButton
            event={event}
            joined={joined}
            onToggle={onToggle}
            pending={pending}
            isHost={isHost}
          />
        </div>
      </div>
    </article>
  );
}

export default EventCard;
