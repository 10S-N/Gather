import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { uploadImage } from '../services/uploads';
import { updateUserProfile } from '../services/userProfile';

// The parent (ProfilePage) renders this component only while the editor is
// open, so a fresh instance mounts per open and there's no need for a reset
// effect — initializers pick up the current user and cover URL directly.
function EditProfileModal({ onClose, currentCoverURL }) {
  const { user, updateAuthProfileInfo } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatarSource, setAvatarSource] = useState({
    kind: user?.photoURL ? 'existing' : 'empty',
    url: user?.photoURL || '',
    file: null,
    preview: user?.photoURL || '',
  });
  const [coverSource, setCoverSource] = useState({
    kind: currentCoverURL ? 'existing' : 'empty',
    url: currentCoverURL || '',
    file: null,
    preview: currentCoverURL || '',
  });
  const [error, setError] = useState('');
  const [stage, setStage] = useState(null); // 'uploading-avatar' | 'uploading-cover' | 'saving' | null
  const [removeCover, setRemoveCover] = useState(false);
  const [avatarRemoved, setAvatarRemoved] = useState(false);

  // Escape-to-close (only when not in the middle of an upload).
  useEffect(() => {
    if (stage) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  const readFileToDataURL = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const preview = await readFileToDataURL(file);
      setAvatarSource({ kind: 'file', url: '', file, preview });
      setAvatarRemoved(false);
    } catch {
      setError('Could not read the selected image.');
    }
  };

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const preview = await readFileToDataURL(file);
      setCoverSource({ kind: 'file', url: '', file, preview });
      setRemoveCover(false);
    } catch {
      setError('Could not read the selected image.');
    }
  };

  const handleAvatarUrl = (e) => {
    const url = e.target.value.trim();
    setAvatarSource({ kind: 'url', url, file: null, preview: url });
    setAvatarRemoved(false);
  };

  const handleCoverUrl = (e) => {
    const url = e.target.value.trim();
    setCoverSource({ kind: 'url', url, file: null, preview: url });
    if (url) setRemoveCover(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2) {
      setError('Display name must be at least 2 characters.');
      return;
    }
    if (!user) return;

    let avatarURL = user.photoURL || '';
    let coverURL = currentCoverURL || null;

    try {
      // 1. Avatar URL resolution
      if (avatarRemoved) {
        avatarURL = '';
      } else if (avatarSource.kind === 'file' && avatarSource.file) {
        setStage('uploading-avatar');
        avatarURL = await uploadImage(avatarSource.file, `avatars/${user.uid}`);
      } else if (avatarSource.kind === 'url') {
        avatarURL = avatarSource.url;
      }

      // 2. Cover URL resolution
      if (coverSource.kind === 'file' && coverSource.file) {
        setStage('uploading-cover');
        coverURL = await uploadImage(coverSource.file, `covers/${user.uid}`);
      } else if (coverSource.kind === 'url') {
        coverURL = coverSource.url;
      } else if (coverSource.kind === 'empty' || removeCover) {
        coverURL = null;
      }

      // 3. Push name + avatar to Firebase Auth (photoURL only — no cover slot)
      setStage('saving');
      await updateAuthProfileInfo({
        displayName: trimmedName,
        photoURL: avatarURL,
      });

      // 4. Persist cover photo in Firestore users/{uid}
      await updateUserProfile(user.uid, { coverPhotoURL: coverURL });

      onClose();
    } catch (err) {
      setError(err.message?.replace('Firebase:', '').trim() || 'Something went wrong.');
      setStage(null);
    }
  };

  const stageLabel = {
    'uploading-avatar': 'Uploading profile picture…',
    'uploading-cover': 'Uploading cover photo…',
    saving: 'Saving changes…',
  }[stage || ''] || '';

  const initials = (displayName[0] || user?.email?.[0] || '?').toUpperCase();

  return (
    <div
      onClick={stage ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(40, 56, 89, 0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(2px)',
        padding: '2rem 1rem',
        overflowY: 'auto',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          width: 'min(640px, 100%)',
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(stage)}
          aria-label="Close"
          style={closeBtnStyle}
        >
          ×
        </button>

        <h2 style={{ marginBottom: '0.25rem', color: 'var(--navy)' }}>Edit profile</h2>
        <p style={{ color: 'var(--earth)', marginBottom: '1.5rem', fontSize: '14px' }}>
          Update your display name, profile picture, and cover photo.
        </p>

        {/* Cover preview */}
        <SectionLabel>Cover Photo</SectionLabel>
        <div
          style={{
            height: '140px',
            borderRadius: '12px',
            backgroundColor: 'var(--sand)',
            border: '1px dashed var(--border)',
            backgroundImage: coverSource.preview ? `url(${coverSource.preview})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--earth)',
            fontSize: '13px',
            overflow: 'hidden',
          }}
        >
          {!coverSource.preview && 'No cover photo yet'}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
          <label style={fileBtnStyle}>
            Upload image
            <input
              type="file"
              accept="image/*"
              onChange={handleCoverFile}
              style={{ display: 'none' }}
            />
          </label>
          {currentCoverURL && (
            <button
              type="button"
              disabled={Boolean(stage)}
              onClick={() => {
                setRemoveCover(true);
                setCoverSource({ kind: 'empty', url: '', file: null, preview: '' });
              }}
              style={ghostBtnStyle}
            >
              Remove cover
            </button>
          )}
        </div>
        <input
          type="url"
          placeholder="…or paste an image URL"
          value={coverSource.kind === 'url' ? coverSource.url : ''}
          onChange={handleCoverUrl}
          style={{ ...inputStyle, marginTop: '10px' }}
        />

        {/* Avatar preview */}
        <SectionLabel>Profile Picture</SectionLabel>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {avatarSource.preview ? (
            <img
              src={avatarSource.preview}
              alt="Profile preview"
              style={{
                width: '96px',
                height: '96px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid var(--sand)',
              }}
            />
          ) : (
            <div
              aria-hidden
              style={{
                width: '96px',
                height: '96px',
                borderRadius: '50%',
                backgroundColor: 'var(--rust)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
                fontWeight: 'bold',
                border: '3px solid var(--sand)',
              }}
            >
              {initials}
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={fileBtnStyle}>
              Upload image
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarFile}
                style={{ display: 'none' }}
              />
            </label>
            <input
              type="url"
              placeholder="…or paste an image URL"
              value={avatarSource.kind === 'url' ? avatarSource.url : ''}
              onChange={handleAvatarUrl}
              style={inputStyle}
            />
            {user?.photoURL && !avatarRemoved && avatarSource.kind === 'existing' && (
              <button
                type="button"
                disabled={Boolean(stage)}
                onClick={() => {
                  setAvatarRemoved(true);
                  setAvatarSource({ kind: 'empty', url: '', file: null, preview: '' });
                }}
                style={{ ...ghostBtnStyle, alignSelf: 'flex-start' }}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>

        {/* Display name */}
        <SectionLabel>Display Name</SectionLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          style={inputStyle}
          minLength={2}
          required
        />

        {error && <div style={errorBoxStyle}>{error}</div>}
        {stage && <div style={stageBoxStyle}>{stageLabel}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(stage)}
            style={ghostBtnStyle}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={Boolean(stage)}
            style={{
              ...primaryBtnStyle,
              opacity: stage ? 0.75 : 1,
              cursor: stage ? 'not-allowed' : 'pointer',
            }}
          >
            {stage ? 'Working…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: '12px',
        fontWeight: '700',
        color: 'var(--earth)',
        letterSpacing: '0.5px',
        marginTop: '1.25rem',
        marginBottom: '6px',
      }}
    >
      {children.toUpperCase()}
    </label>
  );
}

const closeBtnStyle = {
  position: 'absolute',
  top: '12px',
  right: '14px',
  background: 'none',
  border: 'none',
  fontSize: '22px',
  cursor: 'pointer',
  color: 'var(--earth)',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  fontSize: '15px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fcfbfa',
};

const fileBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'white',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '9px 14px',
  borderRadius: '8px',
  fontWeight: '500',
  cursor: 'pointer',
  fontSize: '14px',
};

const ghostBtnStyle = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '9px 14px',
  borderRadius: '8px',
  fontWeight: '500',
  cursor: 'pointer',
  fontSize: '14px',
};

const primaryBtnStyle = {
  backgroundColor: 'var(--rust)',
  color: 'white',
  border: 'none',
  padding: '11px 20px',
  borderRadius: '8px',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '15px',
};

const errorBoxStyle = {
  marginTop: '12px',
  backgroundColor: '#fdecea',
  color: '#a0322b',
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '13px',
};

const stageBoxStyle = {
  marginTop: '12px',
  backgroundColor: 'var(--sand)',
  color: 'var(--earth)',
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '13px',
};

export default EditProfileModal;
