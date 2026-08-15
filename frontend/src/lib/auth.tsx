"use client";

import type {ReactNode} from "react";

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";

import {api, type ApiAuthUser} from "./api";

export type AuthUser = ApiAuthUser;

type AuthContextValue = {
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
  user: null,
});

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(false);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);

  const invalidateRefresh = useCallback(() => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    requestGenerationRef.current += 1;
    return requestGenerationRef.current;
  }, []);

  const logout = useCallback(async () => {
    const requestGeneration = invalidateRefresh();
    if (mountedRef.current) {
      setUser(null);
      setLoading(false);
    }

    try {
      await api.auth.logout();
    } finally {
      if (mountedRef.current && requestGeneration === requestGenerationRef.current) {
        setUser(null);
        setLoading(false);
      }
    }
  }, [invalidateRefresh]);

  const refresh = useCallback(async () => {
    const requestGeneration = invalidateRefresh();
    const controller = new AbortController();
    refreshControllerRef.current = controller;

    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const currentUser = await api.auth.me(controller.signal);
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestGeneration !== requestGenerationRef.current
      ) return;
      setUser(currentUser);
    } catch {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestGeneration !== requestGenerationRef.current
      ) return;
      setUser(null);
    } finally {
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        requestGeneration === requestGenerationRef.current
      ) setLoading(false);
    }
  }, [invalidateRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => { void refresh(); });
    return () => {
      mountedRef.current = false;
      invalidateRefresh();
    };
  }, [invalidateRefresh, refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const requestGeneration = invalidateRefresh();
    const result = await api.auth.login({username, password});
    if (mountedRef.current && requestGeneration === requestGenerationRef.current) {
      setUser(result.user);
      setLoading(false);
    }
  }, [invalidateRefresh]);

  const value = useMemo(() => ({
    loading,
    login,
    logout,
    refresh,
    user,
  }), [loading, login, logout, refresh, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
