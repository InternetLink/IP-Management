import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {I18nProvider} from "../src/i18n";

const mocks = vi.hoisted(() => ({
  allocationHeatmap: vi.fn(),
  allocations: vi.fn(),
  allocationStatusCounts: vi.fn(),
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
      get: mocks.getPrefix,
    },
  },
}));

import {PrefixDetailPage} from "../src/views/prefix-detail-page";

const prefix = {
  _count: {allocations: 2, children: 0},
  assignedTo: null,
  children: [],
  cidr: "192.0.2.0/24",
  createdAt: "2026-08-15T00:00:00.000Z",
  depth: 0,
  description: "",
  gateway: null,
  id: "prefix-1",
  isPool: true,
  parent: null,
  parentId: null,
  rir: "APNIC",
  status: "Active",
  totalIPs: 256,
  totalIPsExact: "256",
  updatedAt: "2026-08-15T00:00:00.000Z",
  usedIPs: 1,
  usedIPsExact: "1",
  version: 4,
  vlan: null,
} as const;

const allocations = [
  {
    assignee: "",
    assignedDate: "2026-08-15T00:00:00.000Z",
    createdAt: "2026-08-15T00:00:00.000Z",
    expiryDate: null,
    id: "allocation-1",
    ipAddress: "192.0.2.1",
    notes: null,
    prefixId: "prefix-1",
    purpose: "Server",
    status: "Available",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
  {
    assignee: "customer-a",
    assignedDate: "2026-08-15T00:00:00.000Z",
    createdAt: "2026-08-15T00:00:00.000Z",
    expiryDate: null,
    id: "allocation-2",
    ipAddress: "192.0.2.2",
    notes: null,
    prefixId: "prefix-1",
    purpose: "Customer",
    status: "Allocated",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
] as const;

describe("PrefixDetailPage allocation pagination", () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getPrefix.mockResolvedValue(prefix);
    mocks.allocationStatusCounts.mockResolvedValue({Available: 1, Allocated: 1, Reserved: 0});
    mocks.allocationHeatmap.mockResolvedValue({
      bucketCount: 256,
      buckets: Array.from({length: 256}, (_, index) => ({
        capacity: "1",
        counts: index === 1
          ? {Available: 1, Allocated: 0, Reserved: 0}
          : index === 2
            ? {Available: 0, Allocated: 1, Reserved: 0}
            : {Available: 0, Allocated: 0, Reserved: 0},
        endAddress: `192.0.2.${index}`,
        index,
        startAddress: `192.0.2.${index}`,
      })),
      totalCapacity: "256",
    });
    mocks.allocations.mockImplementation(async (_id: string, query?: {status?: string}) => ({
      items: query?.status === "Available" ? [allocations[0]] : [...allocations],
      nextCursor: null,
    }));
  });

  it("requests a new server page and clears selection when the status query changes", async () => {
    render(<I18nProvider><PrefixDetailPage prefixId="prefix-1" /></I18nProvider>);

    await screen.findByText("192.0.2.1");
    expect(screen.getAllByTestId("allocation-heatmap-bucket")).toHaveLength(256);

    fireEvent.click(screen.getByRole("checkbox", {name: "Select 192.0.2.1"}));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: /^Available/}));

    await waitFor(() => expect(mocks.allocations).toHaveBeenLastCalledWith(
      "prefix-1",
      {limit: 50, status: "Available"},
      expect.any(AbortSignal),
    ));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });
});
