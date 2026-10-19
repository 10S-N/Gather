import { useEffect, useState } from 'react';
import { subscribeEvent } from '../services/events';
import { normalizeCommunityEvent } from '../utils/events';

// Single-event subscription used by the detail page so the attendee count and
// edits stay live for everyone viewing.
export function useCommunityEvent(id) {
  const [state, setState] = useState({ id: null, event: null, loaded: false, error: null });

  useEffect(() => {
    if (!id) return undefined;
    const unsub = subscribeEvent(
      id,
      (row) => {
        setState({
          id,
          event: row ? normalizeCommunityEvent(row.id, row) : null,
          loaded: true,
          error: null,
        });
      },
      (err) => {
        setState({
          id,
          event: null,
          loaded: true,
          error: err?.message?.replace('Firebase:', '').trim() || 'Could not load this event.',
        });
      },
    );
    return unsub;
  }, [id]);

  const current = state.id === id;
  return {
    event: current ? state.event : null,
    loading: !current || !state.loaded,
    error: current ? state.error : null,
  };
}
