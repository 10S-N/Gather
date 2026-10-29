import { Link } from 'react-router-dom';
import RsvpButton from './RsvpButton';
import { CATEGORY_EMOJI } from '../data/neighborhoods';
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
  return event.hostName || 'A neighbor';
}

// One tile, not one screen: the feed is dense like an explore grid, so a card
// carries a picture, why it is here, what/where it is, and one action. Anything
// longer lives on the event page the tile links to.
function RecommendationCard({ event, reason = '', joined = false, pending = false, onToggle, isHost = false }) {
  const place = event.neighborhood || event.location || 'Austin, TX';
  const isCommunity = event.source === 'community';

  return (
    <article className="rec-card">
      <div className="rec-card__media">
        {event.image ? (
          <img className="rec-card__image" src={event.image} alt="" loading="lazy" />
        ) : (
          <div className="rec-card__fallback" aria-hidden="true">
            {CATEGORY_EMOJI[event.category] || '✦'}
          </div>
        )}

        <div className="rec-card__badges">
          <span className="badge">{event.category}</span>
          {event.price && (
            <span className={`badge ${event.price === 'Free' ? 'badge--sage' : 'badge--sand'}`}>
              {event.price}
            </span>
          )}
        </div>
      </div>

      <div className="rec-card__body">
        {reason && (
          <p className="rec-card__reason" title={reason}>
            <span aria-hidden="true">✦</span> {reason}
          </p>
        )}

        <h2 className="rec-card__title">
          <Link to={`/event/${event.id}`} state={{ event }}>
            {event.title}
          </Link>
        </h2>

        <p className="rec-card__meta">
          <span className="rec-card__when">{formatWhen(event)}</span>
          <span aria-hidden="true">·</span>
          <span className="rec-card__place">{place}</span>
        </p>

        <div className="rec-card__footer">
          <span className="rec-card__host">
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
                {isCommunity ? initialsOf(event.hostName) : event.source === 'curated' ? '✦' : '🎟'}
              </span>
            )}
            <span className="rec-card__source">{sourceLabel(event)}</span>
          </span>

          <span className="rec-card__actions">
            <RsvpButton
              event={event}
              joined={joined}
              onToggle={onToggle}
              pending={pending}
              isHost={isHost}
              block={false}
            />
          </span>
        </div>
      </div>
    </article>
  );
}

export default RecommendationCard;
