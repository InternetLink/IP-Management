"use client";

import {Bell, Magnifier, Globe} from "@gravity-ui/icons";
import {Button, Dropdown, Label} from "@heroui/react";
import {AppLayout, Navbar, Sidebar} from "@heroui-pro/react";

import {useI18n, LOCALE_LABELS, type Locale} from "../i18n";
import {useAuth} from "../lib/auth";
import {IconButton} from "./icon-button";

export interface DashboardNavbarProps {
  title?: string;
}

export function DashboardNavbar({title}: DashboardNavbarProps) {
  const {t, locale, setLocale} = useI18n();
  const {user} = useAuth();

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle />
        <Sidebar.Trigger />
        <h1 className="text-foreground truncate text-xl font-semibold">{title ?? t.dashboard.title}</h1>
        <Navbar.Spacer />
        <div className="flex items-center gap-2">
          <IconButton label={t.common.search} size="sm" variant="tertiary">
            <Magnifier className="size-4" />
          </IconButton>
          <IconButton label="Notifications" size="sm" variant="tertiary">
            <Bell className="size-4" />
          </IconButton>
          {user && <span className="text-muted hidden text-xs font-medium sm:inline">{user.username}</span>}

          {/* Language Switcher — icons only, no emoji */}
          <Dropdown>
            <Button size="sm" variant="secondary">
              <Globe className="size-4" />{LOCALE_LABELS[locale]}
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu onAction={(key) => setLocale(key as Locale)}>
                <Dropdown.Item id="en" textValue="English"><Label>EN — English</Label></Dropdown.Item>
                <Dropdown.Item id="zh-TW" textValue="繁體中文"><Label>TW — 繁體中文</Label></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </Navbar.Header>
    </Navbar>
  );
}
