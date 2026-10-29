import { useCallback, useEffect, useState } from 'react';
import { subscribeUserProfile, updateUserProfile } from '../services/userProfile';
import { normalizePicks } from '../utils/recommend.js';

// Picks live on the user's Firestore doc next to the cover photo, so they
// survive a refresh and follow the person across devices:
//
//   users/{uid}.preferences = { categories: [], neighborhoods: [], onboardingComplete: true }
//
// `onboardingComplete` is stored rather than inferred, so someone who
// deliberately saved an empty pick list is not asked again on every login.
export function normalizePreferences(data) {
  const picks = normalizePicks(data);
  return {
    ...picks,
    complete: Boolean(data?.onboardingComplete) || picks.categories.length + picks.neighborhoods.length > 0,
  };
}

export function usePreferences(user) {
  const [state, setState] = useState({ uid: null, preferences: null, loaded: false, error: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return undefined;

    const unsub = subscribeUserProfile(user.uid, (data, readError) => {
      setState({
        uid: user.uid,
        // A denied/failed profile read must not block browsing. Treat the user
        // as having no picks and let the page fall back to the whole board.
        preferences: normalizePreferences(readError ? null : data?.preferences),
        loaded: true,
        error: readError ? 'Could not load your picks.' : '',
      });
    });
    return unsub;
  }, [user]);

  // Guards against showing the previous account's picks for a frame while the
  // new snapshot is on its way (and after signing out).
  const ready = Boolean(user) && state.uid === user.uid;
  const preferences = ready ? state.preferences : null;

  const save = useCallback(
    async (picks) => {
      if (!user) throw new Error('Sign in to save your picks.');
      setSaving(true);
      setState((prev) => ({ ...prev, error: '' }));
      try {
        const normalized = normalizePicks(picks);
        await updateUserProfile(user.uid, {
          preferences: { ...normalized, onboardingComplete: true },
        });
      } catch (err) {
        const message =
          err?.message?.replace('Firebase:', '').trim() || 'Could not save your picks. Please try again.';
        setState((prev) => ({ ...prev, error: message }));
        throw new Error(message, { cause: err });
      } finally {
        setSaving(false);
      }
    },
    [user],
  );

  return {
    preferences,
    loaded: !user || (ready && state.loaded),
    saving,
    error: ready ? state.error : '',
    save,
  };
}
