import {act, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  replace: vi.fn(),
  status: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace: mocks.replace}),
}));

vi.mock("../src/lib/api", () => ({
  api: {auth: {status: mocks.status}},
}));

vi.mock("../src/lib/auth", () => ({
  useAuth: () => ({login: mocks.login, user: null}),
}));

import {LoginPage} from "../src/views/login-page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
}

describe("LoginPage bootstrap state", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.replace.mockReset();
    mocks.status.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows operator guidance and polls until an administrator exists", async () => {
    vi.useFakeTimers();
    mocks.status.mockResolvedValue({hasUsers: false});

    render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", {name: "IPAM needs initialization"})).toBeTruthy();
    expect(screen.queryByRole("textbox", {name: "Username"})).toBeNull();
    expect(screen.queryByText("Create first admin")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.status).toHaveBeenCalledTimes(2);
  });

  it("allows a manual check to supersede an in-flight polling request", async () => {
    vi.useFakeTimers();
    const polling = deferred<{hasUsers: boolean}>();
    const manual = deferred<{hasUsers: boolean}>();
    mocks.status
      .mockResolvedValueOnce({hasUsers: false})
      .mockReturnValueOnce(polling.promise)
      .mockReturnValueOnce(manual.promise);

    render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    fireEvent.click(screen.getByRole("button", {name: "Checking status..."}));
    expect(mocks.status).toHaveBeenCalledTimes(3);

    await act(async () => {
      manual.resolve({hasUsers: true});
      await manual.promise;
    });
    expect(screen.getByRole("heading", {name: "Sign in to IPAM"})).toBeTruthy();

    polling.resolve({hasUsers: false});
  });
});
