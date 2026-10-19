import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';

// One button, three behaviors:
//   - community event  -> toggles the user's Firestore RSVP (prompts sign-in)
//   - external listing -> opens the ticket link in a new tab
//   - host's own event -> static "You're hosting" state
function RsvpButton({ event, joined, onToggle, pending = false, isHost = false, block = true }) {
  const { user } = useAuth();
  const { openLogin } = useAuthModal();

  const baseClass = `btn btn--sm${block ? ' btn--block' : ''}`;

  if (isHost) {
    return (
      <span className={`${baseClass} rsvp rsvp--host`} aria-label="You are hosting this event">
        ★ You&rsquo;re hosting
      </span>
    );
  }

  // Curated and external listings route people to the original listing.
  if (event.source !== 'community') {
    const href = event.url || event.rsvpUrl || event.sourceUrl;
    if (!href) return null;
    return (
      <a
        className={`${baseClass} btn--dark`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Open the original listing for ${event.title}`}
      >
        {event.source === 'curated' ? 'View listing ↗' : 'Tickets ↗'}
      </a>
    );
  }

  const going = event.attendeeCount ?? 0;
  const full = !joined && event.capacity != null && going >= event.capacity;

  const handleClick = () => {
    if (!user) {
      openLogin();
      return;
    }
    if (full) return;
    onToggle?.(event);
  };

  if (full) {
    return (
      <button type="button" className={`${baseClass} btn--ghost rsvp rsvp--full`} disabled>
        Full — {event.capacity} going
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={joined}
      aria-label={
        joined
          ? `Cancel your RSVP for ${event.title}`
          : `RSVP to ${event.title}${user ? '' : ' (sign in required)'}`
      }
      className={`${baseClass} ${joined ? 'rsvp rsvp--going' : 'btn--primary rsvp'}`}
    >
      {pending ? 'Saving…' : joined ? '✓ Going' : user ? '♡ Interested' : '♡ RSVP'}
    </button>
  );
}

export default RsvpButton;
