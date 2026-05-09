"use client";

import type {NavItem} from "../nav-items";

import {Chip} from "@heroui/react";
import {Sidebar} from "@heroui-pro/react";

import {useI18n} from "../i18n";
import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";

interface DashboardSidebarProps {
  pathname: string;
  basePath: string;
}

export function DashboardSidebar({basePath, pathname}: DashboardSidebarProps) {
  return (
    <>
      <Sidebar>
        <SidebarContents basePath={basePath} pathname={pathname} />
      </Sidebar>
      <Sidebar.Mobile>
        <SidebarContents basePath={basePath} idPrefix="mobile-" pathname={pathname} />
      </Sidebar.Mobile>
    </>
  );
}

function SidebarContents({basePath, idPrefix = "", pathname}: {basePath: string; pathname: string; idPrefix?: string}) {
  const {t} = useI18n();

  // Map route href to i18n key
  const labelMap: Record<string, string> = {
    "/": t.nav.dashboard,
    "/prefixes": t.nav.prefixes,
    "/geofeed": t.nav.geofeed,
    "/tools": t.nav.tools,
    "/audit-log": t.nav.auditLog,
    "/settings": t.nav.settings,
    "/help": t.nav.help,
    "/logout": t.nav.logout,
  };

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="bg-accent flex size-9 items-center justify-center rounded-lg text-white font-bold text-sm">IP</div>
          <div className="flex min-w-0 flex-col" data-sidebar="label">
            <span className="text-foreground text-sm font-medium leading-tight">{t.sidebar.appName}</span>
            <span className="text-muted text-xs font-medium leading-tight">{t.sidebar.appDesc}</span>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="IPAM navigation">
            {NAV_ITEMS.map((item) => (
              <SidebarNavItem key={item.href} basePath={basePath} idPrefix={idPrefix} item={item} pathname={pathname} label={labelMap[item.href] ?? item.label} />
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu aria-label="Account">
          {FOOTER_ITEMS.map((item) => (
            <SidebarNavItem key={item.href} basePath={basePath} idPrefix={idPrefix} item={item} pathname={pathname} label={labelMap[item.href] ?? item.label} />
          ))}
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  );
}

function SidebarNavItem({basePath, idPrefix = "", item, pathname, label}: {basePath: string; idPrefix: string; item: NavItem; pathname: string; label: string}) {
  const Icon = item.icon;
  const fullHref = basePath + item.href;
  const isCurrent = item.href === "/" ? pathname === fullHref || pathname === basePath || pathname === `${basePath}/` : pathname === fullHref || pathname.startsWith(`${fullHref}/`);

  return (
    <Sidebar.MenuItem href={fullHref} id={`${idPrefix}${item.href}`} isCurrent={isCurrent} textValue={label}>
      <Sidebar.MenuIcon><Icon className="size-4" /></Sidebar.MenuIcon>
      <Sidebar.MenuLabel>{label}</Sidebar.MenuLabel>
      {item.badge ? (<Sidebar.MenuChip><Chip color="success" size="sm" variant="soft">{item.badge}</Chip></Sidebar.MenuChip>) : null}
    </Sidebar.MenuItem>
  );
}
