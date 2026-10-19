import { useEffect, useState } from 'react';
import { subscribeCommunityEvents } from '../services/events';
import { normalizeCommunityEvent } from '../utils/events';

// Live, ordered feed of grassroots events posted by the community. Backed by
// an onSnapshot listener so a new event (or a fresh attendee count) appears
// without a refresh.
export function useCommunityEvents() {
  const [state, setState] = useState({ events: [], loaded: false, error: null });

  useEffect(() => {
    const unsub = subscribeCommunityEvents(
      (rows) => {
        setState({
          events: rows.map(({ id, ...data }) => normalizeCommunityEvent(id, data)),
          loaded: true,
          error: null,
        });
      },
      (err) => {
        setState({
          events: [],
          loaded: true,
          error: err?.message?.replace('Firebase:', '').trim() || 'Could not load the event board.',
        });
      },
    );
    return unsub;
  }, []);

  return { ...state, loading: !state.loaded };
}
