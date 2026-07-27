import { createContext } from 'react'

// Split from AuthProvider.jsx so that file exports only the component
// (react-refresh/only-export-components requires this).
export const AuthContext = createContext(null)
