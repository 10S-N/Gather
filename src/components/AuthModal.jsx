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
  const { signIn, signUp } = useAuth();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
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

        <h2 style={{ marginBottom: '0.25rem', color: 'var(--navy)' }}>
          {activeMode === 'login' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p style={{ color: 'var(--earth)', marginBottom: '1.5rem', fontSize: '14px' }}>
          {activeMode === 'login'
            ? 'Log in to RSVP to local Austin events.'
            : 'Join Gather to discover and post local events.'}
        </p>

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
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 chars)"
            value={password}
            minLength={6}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            required
          />

          {error && (
            <div
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
              backgroundColor: busy ? '#b39083' : 'var(--rust)',
              color: 'white',
              border: 'none',
              padding: '12px',
              borderRadius: '8px',
              fontWeight: 'bold',
              fontSize: '15px',
              cursor: busy ? 'not-allowed' : 'pointer',
              marginTop: '4px',
            }}
          >
            {busy
              ? 'Please wait…'
              : activeMode === 'login'
                ? 'Log In'
                : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '14px', color: 'var(--earth)' }}>
          {activeMode === 'login' ? (
            <>
              New to Gather?{' '}
              <button
                onClick={() => setActiveMode('signup')}
                style={switchBtnStyle}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setActiveMode('login')}
                style={switchBtnStyle}
              >
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
