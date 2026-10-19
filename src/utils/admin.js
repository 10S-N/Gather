// Admin allowlist, configured client-side through VITE_ADMIN_UIDS.
//
// This only controls what the UI *shows*. The serverless endpoint re-checks the
// uid (ADMIN_UIDS) against a verified ID token, and Firestore rules still gate
// every write, so a tampered client cannot grant itself anything.

export function adminUids() {
  return String(import.meta.env.VITE_ADMIN_UIDS || '')
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
}

export function isSyncAdmin(user) {
  if (!user) return false;
  return adminUids().includes(user.uid);
}
