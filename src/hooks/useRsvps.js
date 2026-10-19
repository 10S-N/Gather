import { useCallback, useEffect, useState } from 'react';
import { subscribeMyRsvps, toggleRsvp } from '../services/rsvps';

const EMPTY_SET = new Set();

// Tracks which events the signed-in user is going to, and exposes a toggle
// that writes the membership doc + attendee count in one batch.
export function useMyRsvps(user) {
  const [state, setState] = useState({ uid: null, ids: EMPTY_SET });
  const [pendingIds, setPendingIds] = useState(EMPTY_SET);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    const unsub = subscribeMyRsvps(
      user.uid,
      (rows) => {
        setState({ uid: user.uid, ids: new Set(rows.map((r) => r.eventId)) });
      },
      () => {
        // A failed listener shouldn't block browsing; RSVP buttons fall back
        // to "not going" and the write itself will surface any real error.
        setState({ uid: user.uid, ids: EMPTY_SET });
      },
    );
    return unsub;
  }, [user]);

  const ready = !user || state.uid === user.uid;
  const savedIds = ready ? state.ids : EMPTY_SET;

  const toggle = useCallback(
    async (event) => {
      if (!user) return false;
      const joining = !savedIds.has(event.id);
      setPendingIds((prev) => new Set(prev).add(event.id));
      setError('');
      try {
        await toggleRsvp({ eventId: event.id, user, joining });
        return true;
      } catch (err) {
        setError(
          err?.message?.replace('Firebase:', '').trim() ||
            'Could not update your RSVP. Please try again.',
        );
        return false;
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(event.id);
          return next;
        });
      }
    },
    [user, savedIds],
  );

  return {
    savedIds,
    pendingIds,
    toggle,
    error,
    clearError: useCallback(() => setError(''), []),
  };
}
