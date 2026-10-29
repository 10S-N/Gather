import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  updateProfile as updateAuthProfile,
} from 'firebase/auth';
import { auth } from '../firebase';
import { AuthContext } from './AuthContext';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Firebase Auth mutates and re-notifies the SAME User instance when profile
  // fields change (AuthImpl._updateCurrentUser -> _assign). Passing an
  // identical reference to setUser makes React bail out of re-rendering, so
  // consumers would keep showing the old displayName/photoURL until something
  // else happened to render them. Bumping a counter forces the update through.
  const [, setAuthVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthVersion((version) => version + 1);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signUp = async (email, password, displayName) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateAuthProfile(credential.user, { displayName });
    }
    return credential.user;
  };

  const signIn = (email, password) =>
    signInWithEmailAndPassword(auth, email, password).then((res) => res.user);

  const signOut = () => firebaseSignOut(auth);

  // Emails a reset link through Firebase Auth. It resolves even when the
  // address has no account (unless email enumeration protection is on), which
  // is why the modal confirms without claiming the address exists.
  const resetPassword = (email) => sendPasswordResetEmail(auth, email);

  // Updates Firebase Auth profile fields (displayName + photoURL) and then
  // forces a reload so the onAuthStateChanged listener re-fires and bumps
  // the `user` object exposed via context with the fresh values.
  const updateAuthProfileInfo = async ({ displayName, photoURL }) => {
    if (!auth.currentUser) throw new Error('Not signed in');
    await updateAuthProfile(auth.currentUser, { displayName, photoURL });
    await auth.currentUser.reload();
    // onAuthStateChanged will fire with the freshly-reloaded user object.
  };

  const value = {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updateAuthProfileInfo,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
