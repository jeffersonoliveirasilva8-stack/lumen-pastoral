// Re-exports the centralized AuthContext implementation.
// All 37 consumers keep importing from this path without changes.
export { useAuth, AuthProvider } from "@/contexts/auth-context";
export type { Profile, AuthContextValue } from "@/contexts/auth-context";
