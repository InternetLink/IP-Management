"use client";

import {Globe} from "@gravity-ui/icons";
import {Button, Dropdown, Label} from "@heroui/react";
import {AppLayout, Navbar, Sidebar} from "@heroui-pro/react";

import {useI18n, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale} from "../i18n";
import {useAuth} from "../lib/auth";

export interface DashboardNavbarProps {
  title?: string;
}

export function DashboardNavbar({title}: DashboardNavbarProps) {
  const {t, locale, setLocale} = useI18n();
  const {user} = useAuth();

  return (
    <Navbar maxWidth="full">
      {/*
        Narrow viewports get a tighter gutter and gap so the page title keeps a
        legible share of the 390px header instead of collapsing into an ellipsis.
      */}
      <Navbar.Header className="gap-2 px-4 sm:gap-4 sm:px-6">
        <AppLayout.MenuToggle />
        <Sidebar.Trigger />
        <h1 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold sm:text-xl">{title ?? t.dashboard.title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {user && <span className="text-muted hidden text-xs font-medium sm:inline">{user.username}</span>}

          {/* Language Switcher — icons only, no emoji */}
          <Dropdown>
            {/*
              The visible label shrinks to a locale code on narrow viewports so
              the page title keeps its full width; the accessible name still
              carries the language in full at every size.
            */}
            <Button aria-label={`${t.common.language}: ${LOCALE_LABELS[locale]}`} size="sm" variant="secondary">
              <Globe className="size-4" />
              <span className="sm:hidden">{LOCALE_SHORT_LABELS[locale]}</span>
              <span className="hidden sm:inline">{LOCALE_LABELS[locale]}</span>
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
