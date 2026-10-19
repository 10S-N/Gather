import { useEffect, useState } from 'react';
import { subscribeSyncRuns } from '../services/syncAdmin';

// Live sync history for the admin view. Rules allow signed-in reads only, so
// we subscribe only once a user exists and surface permission errors instead of
// pretending the history is empty.
//
// State is keyed by uid rather than cleared inside the effect: that keeps
// `setState` out of the effect body (no cascading render) and stops a previous
// admin's history from flashing after a sign-out / account switch.
export function useSyncRuns(user, limitCount = 12) {
  const [state, setState] = useState({ uid: null, runs: [], error: null });

  useEffect(() => {
    if (!user) return undefined;

    const uid = user.uid;
    const unsub = subscribeSyncRuns(
      (runs) => setState({ uid, runs, error: null }),
      (err) => {
        const code = err?.code || '';
        setState({
          uid,
          runs: [],
          error:
            code === 'permission-denied'
              ? 'Sync history is not readable yet — deploy the latest firestore.rules.'
              : err?.message?.replace('Firebase:', '').trim() || 'Could not load sync history.',
        });
      },
      limitCount,
    );
    return unsub;
  }, [user, limitCount]);

  const active = Boolean(user) && state.uid === user.uid;
  return {
    runs: active ? state.runs : [],
    loaded: !user || active,
    error: active ? state.error : null,
    loading: Boolean(user) && !active,
  };
}
