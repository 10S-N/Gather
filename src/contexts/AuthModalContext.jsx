import { createContext } from 'react';

// Kept in its own module (matching AuthContext) so providers stay component-only
// exports for React Fast Refresh.
export const AuthModalContext = createContext(null);
