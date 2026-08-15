import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";

import {useApiData} from "../src/lib/use-api";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
}

function RequestProbe({
  fetcher,
  requestKey,
}: {
  readonly fetcher: (requestKey: string, signal: AbortSignal) => Promise<string>;
  readonly requestKey: string;
}) {
  const {data, error, refetch, status} = useApiData(
    (signal) => fetcher(requestKey, signal),
    [requestKey],
  );

  return (
    <main>
      <p data-testid="status">{status}</p>
      <p data-testid="data">{data ?? "empty"}</p>
      <p data-testid="error">{error?.message ?? ""}</p>
      <button type="button" onClick={() => void refetch()}>Retry</button>
    </main>
  );
}

describe("useApiData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the newer result when an older request resolves last", async () => {
    const older = createDeferred<string>();
    const newer = createDeferred<string>();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((requestKey: string, signal: AbortSignal) => {
      signals.push(signal);
      return requestKey === "older" ? older.promise : newer.promise;
    });

    const {rerender} = render(<RequestProbe fetcher={fetcher} requestKey="older" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender(<RequestProbe fetcher={fetcher} requestKey="newer" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      newer.resolve("newer result");
      await newer.promise;
    });
    expect(screen.getByTestId("data").textContent).toBe("newer result");
    expect(screen.getByTestId("status").textContent).toBe("success");

    await act(async () => {
      older.resolve("older result");
      await older.promise;
    });
    expect(screen.getByTestId("data").textContent).toBe("newer result");
  });

  it("keeps stale data visible while a refresh is pending", async () => {
    const initial = createDeferred<string>();
    const refresh = createDeferred<string>();
    const fetcher = vi.fn((requestKey: string) => requestKey === "initial" ? initial.promise : refresh.promise);

    const {rerender} = render(<RequestProbe fetcher={fetcher} requestKey="initial" />);
    await act(async () => {
      initial.resolve("loaded snapshot");
      await initial.promise;
    });

    rerender(<RequestProbe fetcher={fetcher} requestKey="refresh" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(screen.getByTestId("data").textContent).toBe("loaded snapshot");

    await act(async () => {
      refresh.resolve("refreshed data");
      await refresh.promise;
    });
    expect(screen.getByTestId("data").textContent).toBe("refreshed data");
  });

  it("aborts a pending request and avoids state updates after unmount", async () => {
    const pending = createDeferred<string>();
    const requestSignals: AbortSignal[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn((_requestKey: string, signal: AbortSignal) => {
      requestSignals.push(signal);
      return pending.promise;
    });

    const {unmount} = render(<RequestProbe fetcher={fetcher} requestKey="pending" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    unmount();

    expect(requestSignals[0]?.aborted).toBe(true);
    await act(async () => {
      pending.resolve("late result");
      await pending.promise;
    });

    const unmountWarnings = consoleError.mock.calls.filter((call) =>
      call.some((value) => typeof value === "string" && /state update.*unmount|unmounted component/i.test(value)),
    );
    expect(unmountWarnings).toEqual([]);
  });

  it("surfaces a failed request and allows a retry", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("API unavailable"))
      .mockResolvedValueOnce("recovered");

    render(<RequestProbe fetcher={fetcher} requestKey="same" />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("API unavailable");

    fireEvent.click(screen.getByRole("button", {name: "Retry"}));
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("recovered"));
    expect(screen.getByTestId("status").textContent).toBe("success");
  });
});
