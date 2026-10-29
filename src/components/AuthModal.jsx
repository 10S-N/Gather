import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';

function AuthModal({ open, mode, onClose }) {
  // Form state is intentionally local; the parent supplies a `key` that changes
  // whenever mode/open does, which unmounts this component and gives a fresh form.
  const [activeMode, setActiveMode] = useState(mode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set only after a reset link is sent, so the form can hand the screen over
  // to "check your inbox" instead of asking for the email again.
  const [sent, setSent] = useState(false);
  const { signIn, signUp, resetPassword } = useAuth();

  const isReset = activeMode === 'reset';

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const switchMode = (next) => {
    setActiveMode(next);
    setError('');
    setSent(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isReset) {
        await resetPassword(email);
        setSent(true);
        return;
      }
      if (activeMode === 'signup') {
        await signUp(email, password, displayName || email.split('@')[0]);
      } else {
        await signIn(email, password);
      }
      onClose();
    } catch (err) {
      setError(err.message.replace('Firebase:', '').trim());
    } finally {
      setBusy(false);
    }
  };

  const heading = isReset
    ? 'Reset your password'
    : activeMode === 'login'
      ? 'Welcome back'
      : 'Create your account';

  const lede = isReset
    ? 'Enter the email you signed up with and we’ll send you a link to set a new password.'
    : activeMode === 'login'
      ? 'Log in to RSVP to local Austin events.'
      : 'Join Gather to discover and post local events.';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(40, 56, 89, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '420px',
          maxWidth: '92vw',
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '12px',
            right: '14px',
            background: 'none',
            border: 'none',
            fontSize: '22px',
            cursor: 'pointer',
            color: 'var(--earth)',
          }}
        >
          ×
        </button>

        <h2 style={{ marginBottom: '0.25rem', color: 'var(--navy)' }}>{heading}</h2>
        <p style={{ color: 'var(--earth)', marginBottom: '1.5rem', fontSize: '14px' }}>{lede}</p>

        {sent ? (
          <div>
            <div
              role="status"
              style={{
                backgroundColor: 'rgba(174, 184, 92, 0.18)',
                border: '1px solid rgba(174, 184, 92, 0.55)',
                color: '#46501c',
                padding: '12px 14px',
                borderRadius: '8px',
                fontSize: '13.5px',
                lineHeight: 1.5,
              }}
            >
              If there’s an account for <strong>{email}</strong>, a reset link is on its way. It
              expires in an hour — check spam if it hasn’t arrived in a minute.
            </div>

            <button
              type="button"
              onClick={() => switchMode('login')}
              style={{ ...primaryBtnStyle, background: 'var(--rust)', marginTop: '18px' }}
            >
              Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {activeMode === 'signup' && (
              <input
                type="text"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={inputStyle}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="email"
              required
            />
            {!isReset && (
              <input
                type="password"
                placeholder="Password (min 6 chars)"
                value={password}
                minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                autoComplete={activeMode === 'signup' ? 'new-password' : 'current-password'}
                required
              />
            )}

            {activeMode === 'login' && (
              <button
                type="button"
                onClick={() => switchMode('reset')}
                style={{ ...switchBtnStyle, alignSelf: 'flex-end', fontSize: '13px' }}
              >
                Forgot password?
              </button>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  backgroundColor: '#fdecea',
                  color: '#a0322b',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                ...primaryBtnStyle,
                backgroundColor: busy ? '#b39083' : 'var(--rust)',
                cursor: busy ? 'not-allowed' : 'pointer',
                marginTop: '4px',
              }}
            >
              {busy
                ? 'Please wait…'
                : isReset
                  ? 'Send reset link'
                  : activeMode === 'login'
                    ? 'Log In'
                    : 'Create Account'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '14px', color: 'var(--earth)' }}>
          {activeMode === 'login' ? (
            <>
              New to Gather?{' '}
              <button onClick={() => switchMode('signup')} style={switchBtnStyle}>
                Sign up
              </button>
            </>
          ) : (
            <>
              {activeMode === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
              <button onClick={() => switchMode('login')} style={switchBtnStyle}>
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '11px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  fontSize: '15px',
  outline: 'none',
};

const primaryBtnStyle = {
  color: 'white',
  border: 'none',
  padding: '12px',
  borderRadius: '8px',
  fontWeight: 'bold',
  fontSize: '15px',
  width: '100%',
};

const switchBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--rust)',
  fontWeight: 'bold',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: '14px',
  padding: 0,
};

export default AuthModal;
