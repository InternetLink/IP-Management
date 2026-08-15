import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {runAxe} from "./axe";

const mocks = vi.hoisted(() => ({
  geofeedList: vi.fn(),
  prefixRoots: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    geofeed: {
      create: vi.fn(),
      delete: vi.fn(),
      generateUrl: () => "https://ipam.example/geofeed.csv",
      import: vi.fn(),
      list: mocks.geofeedList,
      update: vi.fn(),
    },
    prefixes: {
      create: vi.fn(),
      delete: vi.fn(),
      roots: mocks.prefixRoots,
      update: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({push: vi.fn(), replace: vi.fn()}),
}));

import {I18nProvider} from "../src/i18n";
import {GeofeedPage} from "../src/views/geofeed-page";
import {PrefixTreePage} from "../src/views/prefix-tree-page";

const prefixRoot = {
  _count: {allocations: 12, children: 3},
  assignedTo: "Web Cluster A",
  cidr: "10.0.0.0/22",
  description: "Primary block",
  gateway: "10.0.0.1",
  id: "prefix-1",
  isPool: false,
  rir: "APNIC",
  status: "Active",
  totalIPs: 1024,
  usedIPs: 256,
  version: 4,
  vlan: 100,
};

const geofeedEntry = {
  city: "Taipei",
  countryCode: "TW",
  id: "geo-1",
  lastUpdated: new Date().toISOString(),
  postalCode: "100",
  prefix: "103.152.220.0/24",
  region: "TW-TPE",
  validation: "valid",
};

function seriousViolations(results: Awaited<ReturnType<typeof runAxe>>) {
  return results.violations.filter(({impact}) => impact === "serious" || impact === "critical");
}

async function openViaTrigger(triggerName: string | RegExp) {
  const trigger = await screen.findByRole("button", {name: triggerName});
  (trigger as HTMLElement).focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return {dialog, trigger};
}

describe("migrated dialog call sites", () => {
  beforeEach(() => {
    mocks.geofeedList.mockReset();
    mocks.prefixRoots.mockReset();
    mocks.prefixRoots.mockResolvedValue({items: [prefixRoot], nextCursor: null});
    mocks.geofeedList.mockResolvedValue({items: [geofeedEntry], nextCursor: null});
  });

  it("opens the prefix create dialog with labelled semantics and clean axe results", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);

    const {dialog} = await openViaTrigger("Add Root Prefix");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Add Root Prefix");
    expect(screen.getByLabelText("CIDR")).toBeInTheDocument();

    expect(seriousViolations(await runAxe(dialog))).toEqual([]);
  });

  it("closes the prefix delete confirmation on Escape and restores focus to the row action", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);

    const {dialog, trigger} = await openViaTrigger("Delete");
    expect(dialog.textContent).toContain("Cascade delete cannot be undone.");
    expect(dialog.textContent).toContain("Children: 3");
    expect(dialog.textContent).toContain("Allocations: 12");

    fireEvent.keyDown(dialog, {code: "Escape", key: "Escape"});
    fireEvent.keyUp(dialog, {code: "Escape", key: "Escape"});

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("labels the geofeed CSV import textarea and renders localized instructions", async () => {
    render(<I18nProvider><GeofeedPage /></I18nProvider>);

    const {dialog} = await openViaTrigger("Import CSV");
    const textarea = screen.getByLabelText("Geofeed CSV data");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(dialog.textContent).toContain("Paste RFC 8805 geofeed CSV data.");

    expect(seriousViolations(await runAxe(dialog))).toEqual([]);
  });

  it("labels the geofeed search field and icon-only link actions", async () => {
    render(<I18nProvider><GeofeedPage /></I18nProvider>);

    expect(await screen.findByLabelText("Search geofeed entries")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Copy geofeed URL"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Open geofeed URL"})).toBeInTheDocument();
  });

  it("confirms geofeed deletion with an interpolated prefix", async () => {
    render(<I18nProvider><GeofeedPage /></I18nProvider>);

    const {dialog} = await openViaTrigger("Delete");
    expect(dialog.textContent).toContain("Delete geofeed entry 103.152.220.0/24?");

    expect(seriousViolations(await runAxe(dialog))).toEqual([]);
  });
});
