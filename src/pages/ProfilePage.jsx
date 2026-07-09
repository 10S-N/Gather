import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { subscribeUserProfile } from '../services/userProfile';
import EditProfileModal from '../components/EditProfileModal';

function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const [coverPhotoURL, setCoverPhotoURL] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  // Live-subscribe to the user's Firestore doc so the cover photo and
  // mirrored displayName refresh immediately after the edit modal saves.
  useEffect(() => {
    if (!user) return undefined;
    const unsub = subscribeUserProfile(user.uid, (data, err) => {
      if (err) {
        // Silently fall back — the cover banner simply won't render.
        setCoverPhotoURL(null);
        return;
      }
      setCoverPhotoURL(data?.coverPhotoURL || null);
    });
    return unsub;
  }, [user]);

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--earth)' }}>Loading…</p>
      </div>
    );
  }

  // Not signed in — show a friendly "please sign in" prompt.
  if (!user) {
    return (
      <div
        style={{
          maxWidth: '560px',
          margin: '0 auto',
          padding: '4rem 1.5rem',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '64px', marginBottom: '1rem' }}>👋</div>
        <h1 style={{ marginBottom: '0.5rem' }}>Please sign in</h1>
        <p
          style={{
            color: 'var(--earth)',
            maxWidth: '440px',
            margin: '0 auto 1.75rem',
            fontSize: '16px',
            lineHeight: 1.5,
          }}
        >
          Sign in with your Gather account to view your profile and see events you've
          RSVP'd to or posted yourself.
        </p>
        <Link to="/">
          <button style={primaryBtnStyle}>Back to Events</button>
        </Link>
        <p
          style={{
            marginTop: '1.5rem',
            color: 'var(--earth)',
            fontSize: '13px',
            fontStyle: 'italic',
          }}
        >
          Use the <strong>Log in</strong> or <strong>Sign up</strong> button in the
          top-right corner of the navigation bar.
        </p>
      </div>
    );
  }

  // Signed in — show the user's profile information.
  const displayName =
    user.displayName ||
    (user.email ? user.email.split('@')[0] : user.phoneNumber || 'Gather user');
  const initials = displayName.slice(0, 2).toUpperCase();
  const providerLabel = formatProvider(user.providerData?.[0]?.providerId);

  const handleSignOut = () => {
    if (window.confirm('Sign out of Gather? You can always sign back in.')) {
      signOut();
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0' }}>Your Profile</h1>
        <p style={{ color: 'var(--earth)', margin: 0 }}>Account details</p>
      </header>

      <div
        style={{
          backgroundColor: 'white',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
          position: 'relative',
        }}
      >
        {/* Cover banner — image if present, else a tasteful sand gradient */}
        <div
          aria-hidden
          style={{
            height: '180px',
            backgroundImage: coverPhotoURL ? `url(${coverPhotoURL})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: 'var(--sand)',
            background: coverPhotoURL
              ? `url(${coverPhotoURL}) center/cover no-repeat`
              : 'linear-gradient(135deg, var(--sand) 0%, var(--sage) 100%)',
            borderBottom: '1px solid var(--border)',
          }}
        />

        {/* Avatar overlaid on the banner */}
        <div style={{ padding: '0 2rem', position: 'relative' }}>
          <div style={{ marginTop: '-56px' }}>
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={`${displayName}'s profile picture`}
                style={{
                  width: '112px',
                  height: '112px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '5px solid white',
                  backgroundColor: 'white',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  display: 'block',
                }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: '112px',
                  height: '112px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--rust)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '38px',
                  fontWeight: 'bold',
                  letterSpacing: '1px',
                  border: '5px solid white',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
              >
                {initials}
              </div>
            )}
          </div>

          {/* Display name + Edit button row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              paddingTop: '1rem',
              paddingBottom: '1.5rem',
            }}
          >
            <div>
              <h2 style={{ margin: '0 0 4px 0', color: 'var(--navy)' }}>{displayName}</h2>
              <p style={{ margin: 0, color: 'var(--earth)', fontSize: '13px' }}>
                {user.email ? user.email : 'Signed in by phone'}
              </p>
            </div>
            <button onClick={() => setEditOpen(true)} style={editBtnStyle}>
              Edit profile
            </button>
          </div>
        </div>

        {/* Account detail rows */}
        <div style={{ padding: '0 2rem 2rem' }}>
          <Field
            label="EMAIL ADDRESS"
            value={user.email || '— (signed in by phone)'}
          />
          <Field
            label="EMAIL VERIFIED"
            value={
              user.email
                ? user.emailVerified
                  ? 'Yes ✓'
                  : 'No — check your inbox'
                : 'N/A'
            }
            tone={
              user.email && user.emailVerified
                ? 'good'
                : user.email
                  ? 'warn'
                  : 'muted'
            }
          />
          <Field label="SIGN-IN METHOD" value={providerLabel} />
          {user.displayName && (
            <Field label="DISPLAY NAME" value={user.displayName} />
          )}
          <Field label="USER ID" value={user.uid} mono />

          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button onClick={handleSignOut} style={logoutBtnStyle}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Conditionally mount so a fresh modal state is used each time the
          user opens the editor, without needing internal reset effects. */}
      {editOpen && (
        <EditProfileModal
          onClose={() => setEditOpen(false)}
          currentCoverURL={coverPhotoURL}
        />
      )}
    </div>
  );
}

function formatProvider(providerId) {
  if (!providerId) return 'Unknown';
  const known = {
    password: 'Email & password',
    'google.com': 'Google',
    'github.com': 'GitHub',
    'facebook.com': 'Facebook',
    'apple.com': 'Apple',
    'twitter.com': 'Twitter',
    phone: 'Phone',
  };
  return known[providerId] || providerId;
}

function Field({ label, value, mono, tone }) {
  const valueColor =
    tone === 'good'
      ? 'var(--sage)'
      : tone === 'warn'
        ? 'var(--rust)'
        : tone === 'muted'
          ? 'var(--earth)'
          : 'var(--text)';
  return (
    <div style={{ marginBottom: '14px' }}>
      <label
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--earth)',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        }}
      >
        {label}
      </label>
      <div
        style={{
          padding: '11px 14px',
          borderRadius: '8px',
          backgroundColor: '#fcfbfa',
          border: '1px solid var(--border)',
          fontSize: mono ? '13px' : '15px',
          fontFamily: mono ? 'var(--mono)' : 'var(--sans)',
          color: valueColor,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  backgroundColor: 'var(--rust)',
  color: 'white',
  border: 'none',
  padding: '11px 22px',
  borderRadius: '8px',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '15px',
};

const editBtnStyle = {
  background: 'white',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '9px 16px',
  borderRadius: '8px',
  fontWeight: '600',
  cursor: 'pointer',
  fontSize: '14px',
  whiteSpace: 'nowrap',
};

const logoutBtnStyle = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '10px 20px',
  borderRadius: '8px',
  fontWeight: '500',
  cursor: 'pointer',
  fontSize: '14px',
};

export default ProfilePage;
