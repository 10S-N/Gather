import { useEffect, useState } from 'react';
import { subscribeHostedEvents } from '../services/events';
import { normalizeCommunityEvent, sortEvents } from '../utils/events';

// Events created by the signed-in user. Sorted client-side so the query stays
// index-free (equality-only).
export function useHostedEvents(user) {
  const [state, setState] = useState({ uid: null, events: [], loaded: false, error: null });

  useEffect(() => {
    if (!user) return undefined;
    const unsub = subscribeHostedEvents(
      user.uid,
      (rows) => {
        setState({
          uid: user.uid,
          events: sortEvents(rows.map(({ id, ...data }) => normalizeCommunityEvent(id, data))),
          loaded: true,
          error: null,
        });
      },
      (err) => {
        setState({
          uid: user.uid,
          events: [],
          loaded: true,
          error: err?.message?.replace('Firebase:', '').trim() || 'Could not load your events.',
        });
      },
    );
    return unsub;
  }, [user]);

  const ready = Boolean(user) && state.uid === user.uid;
  return {
    events: ready ? state.events : [],
    loading: Boolean(user) && !ready,
    error: ready ? state.error : null,
  };
}
