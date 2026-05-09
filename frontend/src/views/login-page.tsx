"use client";

import {Button, Card, Input, Label, Spinner, TextField, toast} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useState} from "react";

import {api} from "../lib/api";
import {useAuth} from "../lib/auth";

export function LoginPage() {
  const router = useRouter();
  const {bootstrap, login, user} = useAuth();
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({username: "", password: "", email: ""});

  useEffect(() => {
    if (user) router.replace("/");
  }, [router, user]);

  useEffect(() => {
    api.auth.status()
      .then((status) => setHasUsers(status.hasUsers))
      .catch((error: any) => toast.danger(error.message ?? "Failed to load auth status"))
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.username.trim() || !form.password) {
      toast.danger("Username and password are required");
      return;
    }

    if (!hasUsers && form.password.length < 8) {
      toast.danger("Admin password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      if (hasUsers) {
        await login(form.username, form.password);
      } else {
        await bootstrap({
          username: form.username,
          password: form.password,
          email: form.email.trim() || undefined,
        });
      }
      router.replace("/");
    } catch (error: any) {
      toast.danger(error.message ?? "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }, [bootstrap, form, hasUsers, login, router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-accent/10 via-background to-background px-5">
      <Card className="w-full max-w-md rounded-2xl p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white">IP</div>
          <h1 className="text-foreground text-2xl font-semibold">{hasUsers ? "Sign in to IPAM" : "Create first admin"}</h1>
          <p className="text-muted mt-1 text-sm">
            {hasUsers ? "Use your local administrator account." : "No user exists yet. Create the first administrator account."}
          </p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
          <TextField value={form.username} onChange={(value) => setForm((prev) => ({...prev, username: value}))}>
            <Label>Username</Label>
            <Input autoComplete="username" autoFocus placeholder="admin" />
          </TextField>

          {!hasUsers && (
            <TextField value={form.email} onChange={(value) => setForm((prev) => ({...prev, email: value}))}>
              <Label>Email optional</Label>
              <Input autoComplete="email" placeholder="admin@example.com" type="email" />
            </TextField>
          )}

          <TextField value={form.password} onChange={(value) => setForm((prev) => ({...prev, password: value}))}>
            <Label>Password</Label>
            <Input autoComplete={hasUsers ? "current-password" : "new-password"} placeholder={hasUsers ? "Password" : "At least 8 characters"} type="password" />
          </TextField>

          <Button className="mt-2" isDisabled={submitting} type="submit">
            {hasUsers ? "Sign in" : "Create admin"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
