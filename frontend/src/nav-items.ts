import type {ComponentType} from "react";
import {ChartColumn, CircleQuestion, Gear, House, FolderTree, Clock, Wrench, ArrowRightFromSquare} from "@gravity-ui/icons";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{className?: string}>;
  readonly badge?: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {href: "/", icon: House, label: "Dashboard"},
  {href: "/prefixes", icon: FolderTree, label: "IP Prefixes"},
  {badge: "RFC 8805", href: "/geofeed", icon: ChartColumn, label: "Geofeed"},
  {href: "/tools", icon: Wrench, label: "Tools"},
  {href: "/audit-log", icon: Clock, label: "Audit Log"},
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {href: "/settings", icon: Gear, label: "Settings"},
  {href: "/help", icon: CircleQuestion, label: "Help & Information"},
  {href: "/logout", icon: ArrowRightFromSquare, label: "Log out"},
] as const;
