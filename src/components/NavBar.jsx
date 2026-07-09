import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import AuthModal from './AuthModal';

function NavBar() {
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const openLogin = () => setAuthMode('login');
  const openSignup = () => setAuthMode('signup');
  const close = () => setAuthMode(null);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <>
      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr 220px',
          alignItems: 'center',
          padding: '0.75rem 2rem',
          background: 'var(--navy)',
          color: 'white',
          height: '60px',
          boxSizing: 'border-box',
        }}
      >
        {/* LEFT: Logo Branding */}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 'bold',
                letterSpacing: '1.5px',
                color: 'white',
              }}
            >
              GATHER
            </h2>
          </Link>
        </div>

        {/* MIDDLE: Centered main navigation links */}
        <div style={{ display: 'flex', gap: '40px', justifyContent: 'center' }}>
          <Link to="/" style={navLinkStyle}>
            EVENTS
          </Link>
          <Link to="/messages" style={navLinkStyle}>
            MESSAGES
          </Link>
          <Link to="/profile" style={navLinkStyle}>
            PROFILE
          </Link>
        </div>

        {/* RIGHT: User Authentication Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          {user ? (
            <>
              <span
                title={user.email}
                style={{
                  color: 'white',
                  fontSize: '13px',
                  alignSelf: 'center',
                  maxWidth: '120px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Hi, {user.displayName || user.email.split('@')[0]}
              </span>
              <button
                onClick={handleSignOut}
                style={{
                  background: 'none',
                  border: '1px solid #ffffffa0',
                  color: 'white',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                onClick={openLogin}
                style={{
                  background: 'none',
                  border: '1px solid #ffffffa0',
                  color: 'white',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Log in
              </button>

              <button
                onClick={openSignup}
                style={{
                  background: 'var(--rust)',
                  border: 'none',
                  color: 'white',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Sign up
              </button>
            </>
          )}
        </div>
      </nav>

      {/* key changes whenever the modal opens/closes or switches tabs, so
          form fields reset without triggering cascading renders. */}
      <AuthModal
        key={authMode ?? 'closed'}
        open={authMode !== null}
        mode={authMode}
        onClose={close}
      />
    </>
  );
}

const navLinkStyle = {
  color: '#ffffffb0',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  letterSpacing: '0.5px',
};

export default NavBar;
