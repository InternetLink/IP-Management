import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {I18nProvider} from "../src/i18n";

const mocks = vi.hoisted(() => ({
  auditList: vi.fn(),
  geofeedList: vi.fn(),
  prefixRoots: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({useRouter: () => ({push: mocks.push})}));

vi.mock("../src/lib/api", () => ({
  api: {
    audit: {list: mocks.auditList},
    geofeed: {
      generateUrl: () => "/api/geofeed/generate?",
      list: mocks.geofeedList,
    },
    prefixes: {roots: mocks.prefixRoots},
  },
}));

import {AuditLogPage} from "../src/views/audit-log-page";
import {GeofeedPage} from "../src/views/geofeed-page";
import {PrefixTreePage} from "../src/views/prefix-tree-page";

function prefix(id: string, cidr: string) {
  return {
    _count: {allocations: 0, children: 0}, assignedTo: null, cidr, createdAt: "2026-08-15T00:00:00.000Z",
    depth: 0, description: "", gateway: null, id, isPool: false, parentId: null, rir: "APNIC",
    status: "Active", totalIPs: 256, totalIPsExact: "256", updatedAt: "2026-08-15T00:00:00.000Z",
    usedIPs: 0, usedIPsExact: "0", version: 4, vlan: null,
  } as const;
}

function geofeed(id: string, cidr: string) {
  return {
    city: "Taipei", countryCode: "TW", id, lastUpdated: "2026-08-15T00:00:00.000Z", postalCode: null,
    prefix: cidr, prefixId: null, region: "TPE", validation: "valid", validationMessage: null,
  } as const;
}

function audit(id: string, label: string) {
  return {
    action: "Updated", changes: null, id, resourceId: id, resourceLabel: label, resourceType: "Prefix",
    timestamp: "2026-08-15T00:00:00.000Z", user: "admin",
  } as const;
}

describe("server-paginated DataGrid views", () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
  });

  it("loads the next Prefix root page with the server cursor", async () => {
    mocks.prefixRoots.mockImplementation(async (query?: {cursor?: string}) => query?.cursor
      ? {items: [prefix("prefix-2", "172.16.0.0/12")], nextCursor: null}
      : {items: [prefix("prefix-1", "10.0.0.0/8")], nextCursor: "prefix-1"});

    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    await screen.findByText("10.0.0.0/8");
    fireEvent.click(screen.getByRole("button", {name: "Load more"}));

    await screen.findByText("172.16.0.0/12");
    expect(mocks.prefixRoots).toHaveBeenLastCalledWith(
      {cursor: "prefix-1", limit: 50},
      undefined,
    );
  });

  it("resets Geofeed pagination when server-side search changes", async () => {
    mocks.geofeedList.mockImplementation(async (query?: {cursor?: string; search?: string}) => {
      if (query?.search) return {items: [geofeed("geo-search", "198.51.100.0/24")], nextCursor: null};
      if (query?.cursor) return {items: [geofeed("geo-2", "192.0.2.0/24")], nextCursor: null};
      return {items: [geofeed("geo-1", "10.0.0.0/8")], nextCursor: "geo-1"};
    });

    render(<I18nProvider><GeofeedPage /></I18nProvider>);
    await screen.findByText("10.0.0.0/8");
    fireEvent.click(screen.getByRole("button", {name: "Load more"}));
    await screen.findByText("192.0.2.0/24");

    fireEvent.change(screen.getByRole("searchbox", {name: "Search geofeed entries"}), {target: {value: "198.51"}});
    await waitFor(() => expect(mocks.geofeedList).toHaveBeenLastCalledWith(
      {limit: 50, search: "198.51"},
      expect.any(AbortSignal),
    ));
    await screen.findByText("198.51.100.0/24");
  });

  it("loads and searches Audit pages through the server contract", async () => {
    mocks.auditList.mockImplementation(async (query?: {cursor?: string; search?: string}) => {
      if (query?.search) return {items: [audit("audit-search", "198.51.100.0/24")], nextCursor: null};
      if (query?.cursor) return {items: [audit("audit-2", "192.0.2.0/24")], nextCursor: null};
      return {items: [audit("audit-1", "10.0.0.0/8")], nextCursor: "audit-1"};
    });

    render(<I18nProvider><AuditLogPage /></I18nProvider>);
    await screen.findByText("10.0.0.0/8");
    fireEvent.click(screen.getByRole("button", {name: "Load more"}));
    await screen.findByText("192.0.2.0/24");

    fireEvent.change(screen.getByRole("searchbox", {name: "Search audit log"}), {target: {value: "198.51"}});
    await waitFor(() => expect(mocks.auditList).toHaveBeenLastCalledWith(
      {limit: 100, search: "198.51"},
      expect.any(AbortSignal),
    ));
    await screen.findByText("198.51.100.0/24");
  });
});
