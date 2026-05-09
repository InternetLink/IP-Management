"use client";

import type {ReactNode} from "react";

import {Spinner} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useEffect} from "react";

import {useAuth} from "../../lib/auth";

export function AuthGate({children}: {children: ReactNode}) {
  const router = useRouter();
  const {loading, user} = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
