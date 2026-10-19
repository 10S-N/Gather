import { useContext } from 'react';
import { AuthModalContext } from './AuthModalContext';

// Lets any component (RSVP button, post form, profile CTA) prompt sign-in
// without owning its own copy of the modal.
export function useAuthModal() {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return ctx;
}
