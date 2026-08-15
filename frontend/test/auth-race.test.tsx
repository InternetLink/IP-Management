import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {auth: {login: mocks.login, logout: mocks.logout, me: mocks.me}},
}));

import {AuthProvider, useAuth} from "../src/lib/auth";

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

function AuthProbe() {
  const {loading, logout, refresh, user} = useAuth();

  return (
    <main>
      <p>{loading ? "Loading" : user ? `Signed in as ${user.username}` : "Signed out"}</p>
      <button type="button" onClick={() => void refresh()}>Refresh</button>
      <button type="button" onClick={() => void logout()}>Log out</button>
    </main>
  );
}

describe("AuthProvider request races", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.logout.mockReset();
    mocks.me.mockReset();
  });

  it("keeps the user logged out when an older refresh resolves later", async () => {
    const initialUser = {email: null, id: "user-1", role: "Admin", username: "initial-admin"};
    const staleUser = {email: null, id: "user-2", role: "Admin", username: "stale-admin"};
    const pendingRefresh = createDeferred<typeof staleUser>();
    mocks.me.mockResolvedValueOnce(initialUser).mockReturnValueOnce(pendingRefresh.promise);
    mocks.logout.mockResolvedValue({ok: true});

    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await screen.findByText("Signed in as initial-admin");

    fireEvent.click(screen.getByRole("button", {name: "Refresh"}));
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2));
    const refreshSignal = mocks.me.mock.calls[1]?.[0] as AbortSignal | undefined;

    fireEvent.click(screen.getByRole("button", {name: "Log out"}));
    await screen.findByText("Signed out");
    expect(refreshSignal?.aborted).toBe(true);

    await act(async () => {
      pendingRefresh.resolve(staleUser);
      await pendingRefresh.promise;
    });

    expect(screen.getByText("Signed out").textContent).toBe("Signed out");
    expect(screen.queryByText("Signed in as stale-admin")).toBeNull();
  });
});
