"use client";

import type {ReactNode} from "react";

import {AppLayout} from "@heroui-pro/react";
import {usePathname, useRouter} from "next/navigation";
import {useCallback, useMemo} from "react";

import {useI18n} from "../i18n";

import {DashboardNavbar} from "./dashboard-navbar";
import {DashboardSidebar} from "./dashboard-sidebar";

export interface AppShellProps {
  children: ReactNode;
  basePath?: string;
}

export function AppShell({basePath = "", children}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {t} = useI18n();

  const navigate = useCallback((href: string) => router.push(basePath + href), [router, basePath]);

  const routeLabels = useMemo(() => new Map<string, string>([
    ["/", t.dashboard.title],
    ["/prefixes", t.nav.prefixes],
    ["/geofeed", t.nav.geofeed],
    ["/tools", t.nav.tools],
    ["/audit-log", t.nav.auditLog],
    ["/settings", t.nav.settings],
    ["/help", t.nav.help],
  ]), [t]);

  const title = useMemo(() => {
    const relative = pathname.slice(basePath.length) || "/";
    if (relative === "/" || relative === "") return t.dashboard.title;
    return routeLabels.get(relative) ?? t.dashboard.title;
  }, [pathname, basePath, t, routeLabels]);

  return (
    <AppLayout
      navbar={<DashboardNavbar title={title} />}
      navigate={navigate}
      sidebar={<DashboardSidebar basePath={basePath} pathname={pathname} />}
      sidebarCollapsible="offcanvas"
    >
      {children}
    </AppLayout>
  );
}
