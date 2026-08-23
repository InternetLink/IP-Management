import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {runAxe} from "./axe";

const mocks = vi.hoisted(() => ({
  createPrefix: vi.fn(),
  dashboardStats: vi.fn(),
  push: vi.fn(),
  prefixRoots: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/prefixes",
  useRouter: () => ({push: mocks.push, replace: vi.fn()}),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    dashboard: {getStats: mocks.dashboardStats},
    prefixes: {
      create: mocks.createPrefix,
      delete: vi.fn(),
      roots: mocks.prefixRoots,
      update: vi.fn(),
    },
  },
}));

import {DashboardNavbar} from "../src/components/dashboard-navbar";
import {DashboardSidebar} from "../src/components/dashboard-sidebar";
import {I18nProvider} from "../src/i18n";
import {DashboardPage} from "../src/views/dashboard-page";
import {PrefixTreePage} from "../src/views/prefix-tree-page";

const prefixRoot = {
  _count: {allocations: 0, children: 0},
  assignedTo: "Web Cluster A",
  cidr: "10.0.0.0/22",
  description: "Primary block",
  gateway: "10.0.0.1",
  id: "prefix-1",
  isPool: false,
  rir: "APNIC",
  status: "Active",
  totalIPs: 1024,
  usedIPs: 0,
  version: 4,
  vlan: 100,
};

const zeroStats = {
  allocAllocated: 0,
  allocAvailable: 0,
  allocReserved: 0,
  allocationTrend: [
    {ipv4: 0, ipv6: 0, month: "Jun"},
    {ipv4: 0, ipv6: 0, month: "Jul"},
    {ipv4: 0, ipv6: 0, month: "Aug"},
  ],
  geofeedValid: 0,
  geofeedWarnings: 0,
  ipv6Prefixes: 0,
  prefixStatusCounts: {},
  recentAudit: [],
  rirDistribution: [],
  rootPrefixes: 0,
  totalAllocations: 0,
  totalCapacity: "0",
  totalGeofeed: 0,
  totalIPv4: 0,
  totalPrefixes: 0,
  usedCapacity: "0",
  usedIPv4: 0,
  utilizationBasisPoints: 0,
  utilizationRate: 0,
};

const populatedStats = {
  ...zeroStats,
  allocationTrend: [
    {ipv4: 512, ipv6: 0, month: "Jun"},
    {ipv4: 256, ipv6: 4, month: "Jul"},
  ],
  rirDistribution: [{name: "APNIC", value: 1024}],
  totalIPv4: 1024,
};

function seriousViolations(results: Awaited<ReturnType<typeof runAxe>>) {
  return results.violations.filter(({impact}) => impact === "serious" || impact === "critical");
}

/** Walks up from an element collecting the class list of each ancestor. */
function ancestorClassNames(start: Element, depth: number): string[] {
  const classes: string[] = [];
  let current: Element | null = start.parentElement;
  for (let step = 0; step < depth && current; step += 1) {
    classes.push(current.className);
    current = current.parentElement;
  }
  return classes;
}

async function openCreateDialog() {
  const trigger = await screen.findByRole("button", {name: "Add Root Prefix"});
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

beforeEach(() => {
  mocks.createPrefix.mockReset();
  mocks.dashboardStats.mockReset();
  mocks.prefixRoots.mockReset();
  mocks.push.mockReset();
  mocks.prefixRoots.mockResolvedValue({items: [prefixRoot], nextCursor: null});
  mocks.dashboardStats.mockResolvedValue(zeroStats);
});

describe("shared Dialog modal semantics", () => {
  it("declares aria-modal on the element that carries role=dialog", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The attribute must land on the dialog itself, not on a wrapper, or
    // assistive technology reads it against the wrong node.
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("keeps focus trapped, Escape closing, and scroll lock intact alongside aria-modal", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    expect(document.documentElement.style.overflow).toBe("hidden");

    for (let press = 0; press < 8; press += 1) {
      fireEvent.keyDown(document.activeElement as Element, {key: "Tab"});
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    fireEvent.keyDown(dialog, {code: "Escape", key: "Escape"});
    fireEvent.keyUp(dialog, {code: "Escape", key: "Escape"});

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.documentElement.style.overflow).not.toBe("hidden"));
  });
});

describe("mobile navigation drawer", () => {
  it("gives the drawer dialog a localized accessible name", async () => {
    render(
      <I18nProvider>
        <DashboardSidebar basePath="" pathname="/prefixes" />
      </I18nProvider>,
    );

    const drawer = await screen.findByRole("dialog");
    const labelledBy = drawer.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Navigation menu");

    expect(seriousViolations(await runAxe(drawer))).toEqual([]);
  });
});

describe("dashboard navbar", () => {
  it("ships no inert command controls", () => {
    render(<I18nProvider><DashboardNavbar title="IP Prefixes" /></I18nProvider>);

    // Search and Notifications had no handler and no implementation; they must
    // not reappear as controls that absorb clicks and do nothing.
    expect(screen.queryByRole("button", {name: "Search"})).toBeNull();
    expect(screen.queryByRole("button", {name: "Notifications"})).toBeNull();
    expect(screen.queryByRole("button", {name: /notification/i})).toBeNull();
  });

  it("reserves flexible width for the page title instead of a fixed narrow slot", () => {
    render(<I18nProvider><DashboardNavbar title="IP Prefixes" /></I18nProvider>);

    const heading = screen.getByRole("heading", {level: 1, name: "IP Prefixes"});
    expect(heading.className).toContain("min-w-0");
    expect(heading.className).toContain("flex-1");
  });

  it("keeps the locale control's accessible name complete while its visible label shrinks", () => {
    render(<I18nProvider><DashboardNavbar title="IP Address Management" /></I18nProvider>);

    // The full word costs ~95px of a 390px header, which is what pushed the
    // longest title into an ellipsis; the short code shows instead on mobile.
    const localeButton = screen.getByRole("button", {name: "Language: English"});
    expect(within(localeButton).getByText("EN").className).toContain("sm:hidden");
    expect(within(localeButton).getByText("English").className).toContain("hidden");
  });
});

describe("prefixes page responsive contract", () => {
  it("stacks the page header below the small breakpoint so the primary CTA keeps full width", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);

    const cta = await screen.findByRole("button", {name: "Add Root Prefix"});
    expect(cta.className).toContain("w-full");
    expect(cta.className).toContain("sm:w-auto");

    // The toolbar and the row that holds it must both start stacked, otherwise
    // the CTA is pushed past the viewport edge at 390px.
    const ancestors = ancestorClassNames(cta, 4).join(" ");
    expect(ancestors).toContain("flex-col");
    expect(ancestors).toContain("sm:flex-row");
    expect(ancestors).not.toContain("overflow-x-hidden");
  });
});

describe("root prefix CIDR validation", () => {
  it("marks the CIDR field invalid inline and keeps the dialog open", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    const cidrInput = screen.getByLabelText("CIDR");
    fireEvent.change(cidrInput, {target: {value: "999.999.1.0/24"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));

    await waitFor(() => expect(cidrInput).toHaveAttribute("aria-invalid", "true"));

    const describedBy = cidrInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const messageIds = (describedBy as string).split(" ");
    const messageText = messageIds
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(messageText).toContain("Invalid CIDR format");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.createPrefix).not.toHaveBeenCalled();
  });

  it("moves focus to the failing field so the error is announced with it", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    const cidrInput = screen.getByLabelText("CIDR");
    fireEvent.change(cidrInput, {target: {value: "999.999.1.0/24"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));

    await waitFor(() => expect(document.activeElement).toBe(cidrInput));
  });

  it("clears the inline error as soon as the field changes", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    const cidrInput = screen.getByLabelText("CIDR");
    fireEvent.change(cidrInput, {target: {value: "not-a-cidr"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));
    await waitFor(() => expect(cidrInput).toHaveAttribute("aria-invalid", "true"));

    fireEvent.change(cidrInput, {target: {value: "10.0.0.0/24"}});
    await waitFor(() => expect(cidrInput).not.toHaveAttribute("aria-invalid", "true"));
  });

  it("keeps an unrelated field's error scoped to that field", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    fireEvent.change(screen.getByLabelText("CIDR"), {target: {value: "10.0.0.0/24"}});
    fireEvent.change(screen.getByLabelText("VLAN"), {target: {value: "9999"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));

    await waitFor(() => expect(screen.getByLabelText("VLAN")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("CIDR")).not.toHaveAttribute("aria-invalid", "true");
    expect(mocks.createPrefix).not.toHaveBeenCalled();
  });

  it("drops a stale error when the dialog is reopened", async () => {
    render(<I18nProvider><PrefixTreePage /></I18nProvider>);
    const dialog = await openCreateDialog();

    fireEvent.change(screen.getByLabelText("CIDR"), {target: {value: "bad"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));
    await waitFor(() => expect(screen.getByLabelText("CIDR")).toHaveAttribute("aria-invalid", "true"));

    fireEvent.click(within(dialog).getByRole("button", {name: "Cancel"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openCreateDialog();
    expect(screen.getByLabelText("CIDR")).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("dashboard zero-data charts", () => {
  it("renders explicit empty states instead of bare axes", async () => {
    render(<I18nProvider><DashboardPage /></I18nProvider>);

    expect(await screen.findByText("No activity recorded yet")).toBeInTheDocument();
    expect(screen.getByText("Create a prefix to start building the activity trend.")).toBeInTheDocument();
    expect(screen.getByText("No RIR distribution yet")).toBeInTheDocument();
    expect(screen.getByText("Assign an RIR to a root prefix to see how your space is split.")).toBeInTheDocument();

    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(screen.queryByTestId("pie-chart")).toBeNull();
  });

  it("explains an empty recent-activity grid instead of showing a bare header row", async () => {
    render(<I18nProvider><DashboardPage /></I18nProvider>);

    expect(await screen.findByText("No recent activity")).toBeInTheDocument();
    expect(screen.getByText("Changes to prefixes, allocations, and geofeed entries appear here.")).toBeInTheDocument();
  });

  it("draws the charts once a series carries data", async () => {
    mocks.dashboardStats.mockResolvedValue(populatedStats);
    render(<I18nProvider><DashboardPage /></I18nProvider>);

    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
    expect(screen.queryByText("No activity recorded yet")).toBeNull();
    expect(screen.queryByText("No RIR distribution yet")).toBeNull();
  });
});
