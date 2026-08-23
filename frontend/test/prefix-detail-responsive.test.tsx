import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  allocationHeatmap: vi.fn(),
  allocations: vi.fn(),
  allocationStatusCounts: vi.fn(),
  createPrefix: vi.fn(),
  getPrefix: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({push: mocks.push}),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    prefixes: {
      allocationHeatmap: mocks.allocationHeatmap,
      allocations: mocks.allocations,
      allocationStatusCounts: mocks.allocationStatusCounts,
      create: mocks.createPrefix,
      delete: vi.fn(),
      get: mocks.getPrefix,
      generateIPs: vi.fn(),
      split: vi.fn(),
    },
  },
}));

import {I18nProvider} from "../src/i18n";
import {PrefixDetailPage} from "../src/views/prefix-detail-page";

const prefix = {
  _count: {allocations: 0, children: 0},
  assignedTo: null,
  children: [],
  cidr: "192.0.2.0/24",
  createdAt: "2026-08-15T00:00:00.000Z",
  depth: 0,
  description: "",
  gateway: null,
  id: "prefix-1",
  isPool: false,
  parent: null,
  parentId: null,
  rir: "APNIC",
  status: "Active",
  totalIPs: 256,
  totalIPsExact: "256",
  updatedAt: "2026-08-15T00:00:00.000Z",
  usedIPs: 0,
  usedIPsExact: "0",
  version: 4,
  vlan: null,
} as const;

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

/**
 * Resolves the hero header row from the CIDR heading. Split and Generate IPs
 * also appear in the page's empty state, so header assertions must be scoped
 * rather than matched by accessible name across the whole document.
 */
function heroHeaderRow(): HTMLElement {
  const heading = screen.getByRole("heading", {level: 1, name: "192.0.2.0/24"});
  const row = heading.parentElement?.parentElement?.parentElement;
  if (!row) throw new Error("hero header row not found");
  return row as HTMLElement;
}

async function openAddChildDialog() {
  const trigger = await screen.findByRole("button", {name: "Add Child Prefix"});
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getPrefix.mockResolvedValue(prefix);
  mocks.allocationStatusCounts.mockResolvedValue({Available: 0, Allocated: 0, Reserved: 0});
  mocks.allocationHeatmap.mockResolvedValue(null);
  mocks.allocations.mockResolvedValue({items: [], nextCursor: null});
});

describe("prefix detail responsive contract", () => {
  it("lets the header action group wrap instead of overflowing the viewport", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);
    await screen.findByRole("button", {name: "Add Child Prefix"});

    const generate = within(heroHeaderRow()).getByRole("button", {name: "Generate IPs"});
    // A nowrap action row is what pushed Generate IPs to x=420 on a 390px
    // viewport; the group must be allowed to break onto a second line.
    expect(generate.parentElement?.className).toContain("flex-wrap");

    const ancestors = ancestorClassNames(generate, 4).join(" ");
    expect(ancestors).not.toContain("overflow-x-hidden");
  });

  it("keeps every header action reachable", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);
    await screen.findByRole("button", {name: "Add Child Prefix"});

    const header = within(heroHeaderRow());
    expect(header.getByRole("button", {name: "Split"})).toBeInTheDocument();
    expect(header.getByRole("button", {name: "Add Child Prefix"})).toBeInTheDocument();
    expect(header.getByRole("button", {name: "Generate IPs"})).toBeInTheDocument();
    expect(header.getByRole("button", {name: "Refresh"})).toBeInTheDocument();
  });
});

describe("child prefix CIDR validation", () => {
  it("marks the child CIDR field invalid inline and keeps the dialog open", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);
    const dialog = await openAddChildDialog();

    const cidrInput = screen.getByLabelText("CIDR");
    fireEvent.change(cidrInput, {target: {value: "10.9.9.0/25"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));

    await waitFor(() => expect(cidrInput).toHaveAttribute("aria-invalid", "true"));

    const describedBy = cidrInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const messageText = (describedBy as string)
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(messageText).toContain("Child prefix must be contained by the parent prefix");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.createPrefix).not.toHaveBeenCalled();
    // Focus follows the error so assistive technology announces the field and
    // its message together.
    await waitFor(() => expect(document.activeElement).toBe(cidrInput));
  });

  it("clears the child CIDR error as soon as the field changes", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);
    const dialog = await openAddChildDialog();

    const cidrInput = screen.getByLabelText("CIDR");
    fireEvent.change(cidrInput, {target: {value: "bad-cidr"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));
    await waitFor(() => expect(cidrInput).toHaveAttribute("aria-invalid", "true"));

    fireEvent.change(cidrInput, {target: {value: "192.0.2.0/25"}});
    await waitFor(() => expect(cidrInput).not.toHaveAttribute("aria-invalid", "true"));
  });

  it("does not leak the root dialog's error state into the child dialog", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);
    const dialog = await openAddChildDialog();

    fireEvent.change(screen.getByLabelText("CIDR"), {target: {value: "bad-cidr"}});
    fireEvent.click(within(dialog).getByRole("button", {name: "Create"}));
    await waitFor(() => expect(screen.getByLabelText("CIDR")).toHaveAttribute("aria-invalid", "true"));

    fireEvent.click(within(dialog).getByRole("button", {name: "Cancel"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openAddChildDialog();
    expect(screen.getByLabelText("CIDR")).not.toHaveAttribute("aria-invalid", "true");
  });
});
