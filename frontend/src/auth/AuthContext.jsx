import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TOKEN_KEY, USER_KEY, setUnauthorizedHandler } from '../api/client';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

/** JWT'nin exp alanını okur (imza doğrulaması yapılmaz; yalnızca süre kontrolü) */
function isTokenExpired(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!json.exp) return false;
    return json.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

function loadStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (!token || !userRaw || isTokenExpired(token)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return { token: null, user: null };
    }
    return { token, user: JSON.parse(userRaw) };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(loadStored);
  const [sessionExpired, setSessionExpired] = useState(false);

  const persist = useCallback((token, user) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // depolama kapalı olabilir
    }
    setState({ token, user });
    setSessionExpired(false);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // yok say
    }
    setState({ token: null, user: null });
  }, []);

  // 401 → oturumu kapat
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Açılışta kullanıcı bilgisini tazele (rol değişmiş olabilir)
  useEffect(() => {
    if (!state.token) return;
    let cancelled = false;
    authApi
      .getMe()
      .then((user) => {
        if (!cancelled && user && user.role) {
          try {
            localStorage.setItem(USER_KEY, JSON.stringify(user));
          } catch {
            // yok say
          }
          setState((s) => (s.token ? { ...s, user } : s));
        }
      })
      .catch(() => {
        // Ağ hatasında saklanan kullanıcıyla devam edilir; 401 ise handler çıkış yapar.
      });
    return () => {
      cancelled = true;
    };
    // Yalnızca ilk yüklemede / token değiştiğinde
  }, [state.token]);

  const login = useCallback(
    async (email, password) => {
      const res = await authApi.login(email.trim(), password);
      persist(res.token, res.user);
      return res.user;
    },
    [persist],
  );

  const register = useCallback(
    async (data) => {
      const res = await authApi.register(data);
      persist(res.token, res.user);
      return res.user;
    },
    [persist],
  );

  const value = useMemo(
    () => ({
      token: state.token,
      user: state.user,
      role: state.user?.role || null,
      isAuthenticated: !!state.token,
      sessionExpired,
      clearSessionExpired: () => setSessionExpired(false),
      hasRole: (...roles) => !!state.user && roles.includes(state.user.role),
      login,
      register,
      logout,
    }),
    [state, sessionExpired, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalıdır.');
  return ctx;
}
