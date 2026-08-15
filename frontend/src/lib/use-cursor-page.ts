"use client";

import {useCallback, useEffect, useRef, useState} from "react";

import {useApiData, type ApiDataStatus} from "./use-api";

export type CursorPage<T> = {
  readonly items: T[];
  readonly nextCursor: string | null;
};

type CursorRequest = {
  readonly cursor?: string;
  readonly limit: number;
};

type CursorPageResult<T> = {
  readonly data: CursorPage<T> | null;
  readonly error: Error | null;
  readonly loadMore: () => Promise<void>;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly refetch: () => Promise<void>;
  readonly status: ApiDataStatus;
};

type LoadMoreState = {
  readonly error: Error | null;
  readonly loading: boolean;
  readonly queryKey: string;
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to load the next page");
}

export function useCursorPage<T, Q extends object>(
  fetchPage: (query: Q & CursorRequest, signal?: AbortSignal) => Promise<CursorPage<T>>,
  query: Q,
  pageSize: number,
): CursorPageResult<T> {
  const queryKey = JSON.stringify(query);
  const queryKeyRef = useRef(queryKey);
  const queryRef = useRef(query);
  const fetchRef = useRef(fetchPage);

  useEffect(() => {
    queryKeyRef.current = queryKey;
    queryRef.current = query;
    fetchRef.current = fetchPage;
  }, [fetchPage, query, queryKey]);

  const {
    data,
    error,
    loading,
    refetch: refetchRequest,
    setData,
    status,
  } = useApiData<CursorPage<T>>(
    (signal) => fetchRef.current({...queryRef.current, limit: pageSize}, signal),
    [queryKey, pageSize],
  );
  const [loadMoreState, setLoadMoreState] = useState<LoadMoreState>({
    error: null,
    loading: false,
    queryKey,
  });
  const loadingMore = loadMoreState.queryKey === queryKey && loadMoreState.loading;
  const loadMoreError = loadMoreState.queryKey === queryKey ? loadMoreState.error : null;

  const loadMore = useCallback(async () => {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMore) return;
    const requestQueryKey = queryKeyRef.current;
    setLoadMoreState({error: null, loading: true, queryKey: requestQueryKey});
    try {
      const page = await fetchRef.current({...queryRef.current, cursor, limit: pageSize});
      if (queryKeyRef.current !== requestQueryKey) return;
      setData((current) => current ? {
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor,
      } : page);
    } catch (error: unknown) {
      if (queryKeyRef.current === requestQueryKey) {
        setLoadMoreState((current) => ({...current, error: normalizeError(error), loading: false}));
      }
    } finally {
      if (queryKeyRef.current === requestQueryKey) {
        setLoadMoreState((current) => ({...current, loading: false}));
      }
    }
  }, [data?.nextCursor, loadingMore, pageSize, setData]);

  const refetch = useCallback(async () => {
    setLoadMoreState({error: null, loading: false, queryKey});
    await refetchRequest();
  }, [queryKey, refetchRequest]);

  return {
    data,
    error: loadMoreError ?? error,
    loadMore,
    loading,
    loadingMore,
    refetch,
    status: loadMoreError ? "error" : status,
  };
}
