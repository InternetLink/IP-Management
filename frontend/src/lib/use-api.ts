"use client";

import type {DependencyList, Dispatch, SetStateAction} from "react";

import {useCallback, useEffect, useRef, useState} from "react";

export type ApiDataStatus = "idle" | "loading" | "success" | "error";

type ApiDataFetcher<T> = (signal: AbortSignal) => Promise<T>;

type UseApiDataResult<T> = {
  readonly data: T | null;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly refetch: () => Promise<void>;
  readonly setData: Dispatch<SetStateAction<T | null>>;
  readonly status: ApiDataStatus;
};

function dependenciesAreEqual(previous: DependencyList, next: DependencyList): boolean {
  return previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to load data");
}

/**
 * Fetches API data while cancelling superseded work and preserving stale data during refreshes.
 */
export function useApiData<T>(fetcher: ApiDataFetcher<T>, deps: DependencyList = []): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<ApiDataStatus>("idle");
  const controllerRef = useRef<AbortController | null>(null);
  const dependenciesRef = useRef<DependencyList>([]);
  const fetcherRef = useRef(fetcher);
  const initializedRef = useRef(false);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mountedRef.current) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestGeneration = ++requestGenerationRef.current;

    setStatus("loading");
    setError(null);

    try {
      const result = await fetcherRef.current(controller.signal);
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestGeneration !== requestGenerationRef.current
      ) return;

      setData(result);
      setStatus("success");
    } catch (requestError: unknown) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestGeneration !== requestGenerationRef.current
      ) return;

      setError(normalizeError(requestError));
      setStatus("error");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      initializedRef.current = false;
      requestGenerationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    fetcherRef.current = fetcher;
    if (initializedRef.current && dependenciesAreEqual(dependenciesRef.current, deps)) return;

    initializedRef.current = true;
    dependenciesRef.current = deps;
    void refetch();
  });

  return {
    data,
    error,
    loading: status === "idle" || status === "loading",
    refetch,
    setData,
    status,
  };
}
