import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { deleteAccount, hasPasswordSignIn } from '../services/account';

function messageFor(error) {
  const code = error?.code || '';
  if (code === 'auth/requires-recent-login') {
    return 'For security, sign out and back in, then try again.';
  }
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'That password doesn’t match this account.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return error?.message?.replace('Firebase:', '').trim() || 'Could not delete your account.';
}

// A <details> disclosure rather than a modal: the warning is one click away and
// cannot be opened by accident on the way to something else.
function DeleteAccountPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const detailsRef = useRef(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const needsPassword = hasPasswordSignIn(user);

  const handleDelete = async () => {
    setError('');
    setBusy(true);
    try {
      await deleteAccount(user, password);
      // The auth listener flips `user` to null; send them somewhere real.
      navigate('/');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setPassword('');
    setError('');
  };

  return (
    <details className="danger-zone" ref={detailsRef}>
      <summary>Delete my account</summary>

      <div className="danger-zone__body">
        <p className="danger-zone__copy">
          This removes your profile, cover photo, feed picks and every RSVP you’ve made, then
          closes the sign-in itself. Events you posted stay on the board for everyone else. It
          can’t be undone.
        </p>

        {needsPassword ? (
          <label className="danger-zone__field">
            <span className="danger-zone__label">Confirm with your password</span>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
        ) : (
          <p className="danger-zone__copy">
            You sign in with {user.providerData?.[0]?.providerId || 'a linked provider'}, so we may
            ask you to sign in again before this goes through.
          </p>
        )}

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="danger-zone__actions">
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={handleDelete}
            disabled={busy || (needsPassword && !password)}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </details>
  );
}

export default DeleteAccountPanel;
