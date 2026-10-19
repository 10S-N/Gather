import { useCallback, useMemo, useState } from 'react';
import AuthModal from '../components/AuthModal';
import { AuthModalContext } from './AuthModalContext';

// Mounts exactly one AuthModal for the app. `key` changes whenever the modal
// opens/switches so the form remounts with fresh fields.
export function AuthModalProvider({ children }) {
  const [mode, setMode] = useState(null); // 'login' | 'signup' | null

  const openLogin = useCallback(() => setMode('login'), []);
  const openSignup = useCallback(() => setMode('signup'), []);
  const close = useCallback(() => setMode(null), []);

  const value = useMemo(
    () => ({ openLogin, openSignup, close }),
    [openLogin, openSignup, close],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal
        key={mode ?? 'closed'}
        open={mode !== null}
        mode={mode}
        onClose={close}
      />
    </AuthModalContext.Provider>
  );
}
