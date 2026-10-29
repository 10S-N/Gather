import { useState } from 'react';
import PreferencesPicker from './PreferencesPicker';
import { useAuth } from '../contexts/useAuth';
import { usePreferences } from '../hooks/usePreferences';

// Remembered on the device rather than the session, so "Skip for now" is not
// asked again on every visit.
const DISMISS_KEY = 'gather:picks-dismissed';

function dismissedFor() {
  try {
    return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
}

// Shows the picker once, right after someone signs in, so the Recommended page
// has something to work with. It never reopens on its own: "Skip for now" is
// remembered for the session, and saving sets `onboardingComplete` on the
// profile. The Recommended page's "Edit picks" is the way back in.
function PreferencesOnboarding() {
  const { user, loading } = useAuth();
  const { preferences, loaded, error, save } = usePreferences(user);
  const [skippedFor, setSkippedFor] = useState(dismissedFor);

  // A failed profile read must not look like "this person has no picks".
  if (loading || !user || !loaded || error) return null;
  if (preferences?.complete) return null;
  if (skippedFor === user.uid) return null;

  const handleClose = () => {
    try {
      localStorage.setItem(DISMISS_KEY, user.uid);
    } catch {
      // Private-mode storage failures just mean it may ask again next load.
    }
    setSkippedFor(user.uid);
  };

  return (
    <PreferencesPicker
      mode="onboarding"
      initial={preferences}
      onSave={save}
      onClose={handleClose}
    />
  );
}

export default PreferencesOnboarding;
