import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useState, useCallback } from "preact/hooks";
import { api, ApiError } from "../api";
import type { CurrentUser } from "../types";

/** Either logged straight in, or the account has 2FA enabled and needs a
 * second step — see completeTotpLogin below. */
type LoginResult = { totpRequired: false } | { totpRequired: true; pendingToken: string };

interface AuthState {
  user: CurrentUser | null;
  /** True only during the initial "am I already logged in" check on load. */
  loading: boolean;
  signup: (email: string, password: string, turnstileToken: string) => Promise<{ api_key: string }>;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTotpLogin: (
    pendingToken: string,
    credential: { code?: string; recoveryCode?: string },
  ) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  /** Re-fetches /api/auth/me — used after email verification, which
   * changes server-side state a stale client copy of `user` wouldn't
   * reflect otherwise. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ComponentChildren }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err) => {
        // A 401 here just means "not logged in yet" — expected on first
        // visit, not an error worth surfacing.
        if (!(err instanceof ApiError && err.status === 401)) {
          console.error("failed to check current session", err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const signup = useCallback(async (email: string, password: string, turnstileToken: string) => {
    const result = await api.signup(email, password, turnstileToken);
    // Signup's response doesn't carry created_at (it only needs to hand
    // back the one-time API key) — fetch the authoritative record rather
    // than fabricate a client-side timestamp for it.
    setUser(await api.me());
    return { api_key: result.api_key };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await api.login(email, password);
    if ("totp_required" in result) {
      return { totpRequired: true, pendingToken: result.pending_token };
    }
    setUser(await api.me());
    return { totpRequired: false };
  }, []);

  const completeTotpLogin = useCallback(
    async (pendingToken: string, credential: { code?: string; recoveryCode?: string }) => {
      await api.loginTotp(pendingToken, credential);
      setUser(await api.me());
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await api.me());
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signup, login, completeTotpLogin, logout, deleteAccount, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
