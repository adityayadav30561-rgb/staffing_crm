import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    api
      .get<{ user: User; csrfToken: string }>('/auth/me')
      .then((r) => {
        setCsrfToken(r.csrfToken);
        setUser(r.user);
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setLoading(false));
    const onUnauthorized = () => {
      setUser(null);
      setCsrfToken(null);
      qc.clear();
    };
    window.addEventListener('crm:unauthorized', onUnauthorized);
    return () => window.removeEventListener('crm:unauthorized', onUnauthorized);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User; csrfToken: string }>('/auth/login', { email, password });
    setCsrfToken(r.csrfToken);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setCsrfToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in user (only call inside the authenticated app shell). */
export function useMe(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}
