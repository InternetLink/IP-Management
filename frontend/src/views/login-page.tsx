"use client";

import {Button, Card, Input, Label, Spinner, TextField, toast} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useRef, useState} from "react";

import {api} from "../lib/api";
import {useAuth} from "../lib/auth";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function LoginPage() {
  const router = useRouter();
  const {login, user} = useAuth();
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({username: "", password: ""});
  const statusRequestId = useRef(0);

  useEffect(() => {
    if (user) router.replace("/");
  }, [router, user]);

  const checkStatus = useCallback(async () => {
    const requestId = ++statusRequestId.current;
    setChecking(true);
    setStatusError(null);

    try {
      const status = await api.auth.status();
      if (requestId === statusRequestId.current) setHasUsers(status.hasUsers);
    } catch (error: unknown) {
      if (requestId === statusRequestId.current) {
        setStatusError(errorMessage(error, "Failed to load auth status"));
      }
    } finally {
      if (requestId === statusRequestId.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void checkStatus(); });
  }, [checkStatus]);

  useEffect(() => {
    if (hasUsers !== false) return undefined;

    const interval = window.setInterval(() => {
      void checkStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [checkStatus, hasUsers]);

  const handleSubmit = useCallback(async () => {
    if (!form.username.trim() || !form.password) {
      toast.danger("Username and password are required");
      return;
    }

    setSubmitting(true);
    try {
      await login(form.username, form.password);
      router.replace("/");
    } catch (error: unknown) {
      toast.danger(errorMessage(error, "Authentication failed"));
    } finally {
      setSubmitting(false);
    }
  }, [form, login, router]);

  if (hasUsers === null && checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner aria-label="Loading authentication status" size="lg" />
      </div>
    );
  }

  if (hasUsers === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-accent/10 via-background to-background px-5">
        <Card className="w-full max-w-md rounded-2xl p-6 shadow-xl">
          <div className="mb-6">
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white">IP</div>
            <h1 className="text-foreground text-2xl font-semibold">Initialization status unavailable</h1>
            <p className="text-muted mt-1 text-sm">{statusError ?? "The server did not return its initialization status."}</p>
          </div>
          <Button onPress={() => { void checkStatus(); }}>Check again</Button>
        </Card>
      </main>
    );
  }

  if (!hasUsers) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-accent/10 via-background to-background px-5">
        <Card className="w-full max-w-md rounded-2xl p-6 shadow-xl">
          <div className="mb-6">
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white">IP</div>
            <h1 className="text-foreground text-2xl font-semibold">IPAM needs initialization</h1>
            <p className="text-muted mt-1 text-sm">
              Run <code>npm run auth:bootstrap</code> from the backend environment with the documented bootstrap variables to create the first administrator account.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button onPress={() => { void checkStatus(); }}>
              {checking ? "Checking status..." : "Check again"}
            </Button>
            <p aria-atomic="true" aria-live="polite" className="text-muted text-center text-xs" role="status">
              {statusError ?? (checking ? "Checking for an administrator account..." : "This page checks automatically while the instance is uninitialized.")}
            </p>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-accent/10 via-background to-background px-5">
      <Card className="w-full max-w-md rounded-2xl p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white">IP</div>
          <h1 className="text-foreground text-2xl font-semibold">Sign in to IPAM</h1>
          <p className="text-muted mt-1 text-sm">Use your local administrator account.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
          <TextField value={form.username} onChange={(value) => setForm((prev) => ({...prev, username: value}))}>
            <Label>Username</Label>
            <Input autoComplete="username" autoFocus placeholder="admin" />
          </TextField>

          <TextField value={form.password} onChange={(value) => setForm((prev) => ({...prev, password: value}))}>
            <Label>Password</Label>
            <Input autoComplete="current-password" placeholder="Password" type="password" />
          </TextField>

          <Button className="mt-2" isDisabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
