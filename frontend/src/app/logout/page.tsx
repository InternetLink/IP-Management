"use client";

import {Spinner} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useEffect} from "react";

import {useAuth} from "../../lib/auth";

export default function LogoutPage() {
  const router = useRouter();
  const {logout} = useAuth();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await logout();
      } catch {
        // The BFF clears cookies on handled backend failures.
      }
      if (active) router.replace("/login");
    })();

    return () => {
      active = false;
    };
  }, [logout, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner size="lg" />
    </div>
  );
}
