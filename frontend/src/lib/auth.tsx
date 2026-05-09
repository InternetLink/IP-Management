"use client";

import type {ReactNode} from "react";

import {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";

import {api, clearAuthToken, getAuthToken, setAuthToken} from "./api";

export type AuthUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
};

type AuthContextValue = {
  bootstrap: (data: {username: string; password: string; email?: string}) => Promise<void>;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue>({
  bootstrap: async () => {},
  loading: true,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
  user: null,
});

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      setUser(null);
      return;
    }

    setLoading(true);
    try {
      const currentUser = await api.auth.me();
      setUser(currentUser);
    } catch {
      clearAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.auth.login({username, password});
    setAuthToken(result.token);
    setUser(result.user);
  }, []);

  const bootstrap = useCallback(async (data: {username: string; password: string; email?: string}) => {
    const result = await api.auth.bootstrap(data);
    setAuthToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo(() => ({
    bootstrap,
    loading,
    login,
    logout,
    refresh,
    user,
  }), [bootstrap, loading, login, logout, refresh, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
