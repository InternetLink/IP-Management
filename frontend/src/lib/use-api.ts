"use client";

import {useCallback, useEffect, useState} from "react";

/**
 * Hook to fetch data from the backend API with loading/error states and refetch support.
 */
export function useApiData<T>(fetcher: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err: any) {
      setError(err.message ?? "Failed to load data");
      console.error("API Error:", err);
    } finally {
      setLoading(false);
    }
  // Callers pass the dependencies that define their fetch query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { refetch(); }, [refetch]);

  return {data, loading, error, refetch, setData};
}
