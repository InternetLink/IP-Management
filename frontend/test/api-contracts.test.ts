import {afterEach, describe, expect, it, vi} from "vitest";

import {ApiPayloadError, api, parseDecimalString} from "../src/lib/api";
import {formatGeofeedImportErrors, formatGeofeedImportSummary, formatSplitToastDescription} from "../src/lib/api-display";
import type {DecimalString} from "../src/lib/api-types";

type DecimalStringMustNotBeNumber = Extract<DecimalString, number> extends never ? true : never;
const decimalStringMustNotBeNumber: DecimalStringMustNotBeNumber = true;

describe("API response contracts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a numeric dashboard capacity before it reaches callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({totalCapacity: 12345}), {
      headers: {"content-type": "application/json"},
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.dashboard.getStats()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      kind: "payload",
      status: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("brands and validates exact decimal strings", () => {
    expect(parseDecimalString("340282366920938463463374607431768211456")).toBe("340282366920938463463374607431768211456");
    expect(() => parseDecimalString(12345, "dashboard.totalCapacity")).toThrow(ApiPayloadError);
    expect(() => parseDecimalString("12.5", "dashboard.totalCapacity")).toThrow(ApiPayloadError);
    expect(decimalStringMustNotBeNumber).toBe(true);
  });

  it("forwards an AbortSignal from a public read method to fetch", async () => {
    const settings = {
      asn: "AS64512",
      contactEmail: "noc@example.com",
      defaultCountryCode: "DE",
      defaultRIR: "RIPE NCC",
      expiryWarningDays: 30,
      geofeedAutoASN: true,
      geofeedHeader: "# Geofeed",
      geofeedPublicUrl: null,
      organizationName: "Example Network",
      utilizationThreshold: 85,
      version: "a".repeat(64),
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(settings), {
      headers: {"content-type": "application/json"},
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(api.settings.get(controller.signal)).resolves.toEqual(settings);

    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestOptions?.signal).toBe(controller.signal);
  });

  it("parses allocation pages and sends bounded query parameters", async () => {
    const allocation = {
      assignee: "customer-a",
      assignedDate: "2026-08-15T00:00:00.000Z",
      createdAt: "2026-08-15T00:00:00.000Z",
      expiryDate: null,
      id: "allocation-1",
      ipAddress: "192.0.2.1",
      notes: null,
      prefixId: "prefix-1",
      purpose: "Customer",
      status: "Allocated",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [allocation],
      nextCursor: "allocation-1",
    }), {headers: {"content-type": "application/json"}, status: 200}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.prefixes.allocations("prefix-1", {
      cursor: "allocation-0",
      limit: 25,
      status: "Allocated",
    })).resolves.toEqual({items: [allocation], nextCursor: "allocation-1"});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/prefixes/prefix-1/allocations?cursor=allocation-0&limit=25&status=Allocated",
      expect.any(Object),
    );
  });

  it("parses allocation status counts and exact-capacity heatmap buckets", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({Available: 3, Allocated: 2, Reserved: 1}), {
        headers: {"content-type": "application/json"}, status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        bucketCount: 256,
        buckets: Array.from({length: 256}, (_, index) => ({
          capacity: "18446744073709551616",
          counts: {Available: 3, Allocated: 2, Reserved: 1},
          endAddress: "2001:db8::ffff",
          index,
          startAddress: "2001:db8::",
        })),
        totalCapacity: "340282366920938463463374607431768211456",
      }), {headers: {"content-type": "application/json"}, status: 200}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.prefixes.allocationStatusCounts("prefix-1")).resolves.toEqual({Available: 3, Allocated: 2, Reserved: 1});
    const heatmap = await api.prefixes.allocationHeatmap("prefix-1");
    expect(heatmap.totalCapacity).toBe("340282366920938463463374607431768211456");
    expect(heatmap.buckets[0]?.capacity).toBe("18446744073709551616");
  });
});

describe("response-driven UI messages", () => {
  it("uses the split count directly in the toast description", () => {
    expect(formatSplitToastDescription(4, "children created")).toBe("4 children created");
  });

  it("includes failed geofeed lines in the import feedback", () => {
    const result = {failed: 2, imported: 3};
    const errors = [
      {input: "bad-row", line: 7, message: "CIDR is invalid"},
      {input: "other-row", line: 9, message: "Country code is invalid"},
    ] as const;

    expect(formatGeofeedImportSummary(result)).toBe("3 entries imported, 2 failed");
    expect(formatGeofeedImportErrors(errors)).toContain("Line 7: CIDR is invalid");
    expect(formatGeofeedImportErrors(errors)).toContain("Line 9: Country code is invalid");
    expect(formatGeofeedImportSummary({imported: 3, failed: 0})).toBe("3 entries imported, 0 failed");
  });
});
