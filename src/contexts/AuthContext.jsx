import { createContext } from 'react';

// Context object lives in its own module so the provider file can remain a
// component-only export (required by React Fast Refresh linting).
export const AuthContext = createContext(null);
