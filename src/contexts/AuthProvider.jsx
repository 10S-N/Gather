import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile as updateAuthProfile,
} from 'firebase/auth';
import { auth } from '../firebase';
import { AuthContext } from './AuthContext';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
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
    updateAuthProfileInfo,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
