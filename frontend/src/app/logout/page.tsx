"use client";

import {Spinner} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useEffect} from "react";

import {useAuth} from "../../lib/auth";

export default function LogoutPage() {
  const router = useRouter();
  const {logout} = useAuth();

  useEffect(() => {
    logout();
    router.replace("/login");
  }, [logout, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner size="lg" />
    </div>
  );
}
