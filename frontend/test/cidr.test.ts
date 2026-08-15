import {describe, expect, it} from "vitest";

import {bigIntToIPv6, getSubnetInfo, ipSortValue, ipv6ToBigInt, splitCidr} from "../src/lib/cidr";

describe("CIDR tooling", () => {
  it("returns an empty typed result for invalid input", () => {
    expect(splitCidr("not-a-cidr", 32)).toEqual({kind: "ok", subnets: []});
  });

  it("returns an over-limit result before generating excessive subnets", () => {
    const result = splitCidr("10.0.0.0/0", 11);

    expect(result).toEqual({kind: "over-limit", count: 2048n, limit: 1024});
  });

  it("returns immediately for an IPv4 /0 to /32 split", () => {
    const result = splitCidr("0.0.0.0/0", 32);

    expect(result).toEqual({kind: "over-limit", count: 4294967296n, limit: 1024});
  });

  it("splits a /22 into four /24 subnets", () => {
    const result = splitCidr("10.0.0.0/22", 24);

    expect(result).toEqual({
      kind: "ok",
      subnets: [
        "10.0.0.0/24",
        "10.0.1.0/24",
        "10.0.2.0/24",
        "10.0.3.0/24",
      ],
    });
  });

  it("sorts IPv6 addresses by numeric value", () => {
    const addresses = ["2001:db8::10", "2001:db8::2", "2001:db8::1"];
    const sorted = [...addresses].sort((left, right) => {
      const leftValue = ipSortValue(left);
      const rightValue = ipSortValue(right);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });

    expect(sorted).toEqual(["2001:db8::1", "2001:db8::2", "2001:db8::10"]);
  });

  it("compresses internal IPv6 zero runs without triple-colon output", () => {
    const address = "2001:db8:0:0:1:0:0:1";

    expect(bigIntToIPv6(ipv6ToBigInt(address))).toBe("2001:db8::1:0:0:1");
  });

  it("formats generated IPv6 subnets with valid compressed addresses", () => {
    const result = splitCidr("2001:db8:0:0:1:0:0:1/126", 128);

    expect(result).toEqual({
      kind: "ok",
      subnets: [
        "2001:db8:0:0:1::/128",
        "2001:db8::1:0:0:1/128",
        "2001:db8::1:0:0:2/128",
        "2001:db8::1:0:0:3/128",
      ],
    });
  });

  it("treats every address in an IPv6 /64 as usable", () => {
    const info = getSubnetInfo("2001:db8:abcd:12::42/64");

    expect(info).not.toBeNull();
    if (!info) throw new Error("Expected IPv6 subnet info");

    expect(info.totalHosts).toBe(2 ** 64);
    expect(info.usableHosts).toBe(2 ** 64);
    expect(info.firstUsable).toBe("2001:db8:abcd:12::");
    expect(info.lastUsable).toBe("2001:db8:abcd:12:ffff:ffff:ffff:ffff");
  });

  it("keeps both addresses usable for an IPv6 /127", () => {
    const info = getSubnetInfo("2001:db8::/127");

    expect(info).not.toBeNull();
    if (!info) throw new Error("Expected IPv6 subnet info");

    expect(info.totalHosts).toBe(2);
    expect(info.usableHosts).toBe(2);
    expect(info.firstUsable).toBe("2001:db8::");
    expect(info.lastUsable).toBe("2001:db8::1");
  });

  it("keeps the single address usable for an IPv6 /128", () => {
    const info = getSubnetInfo("2001:db8::1/128");

    expect(info).not.toBeNull();
    if (!info) throw new Error("Expected IPv6 subnet info");

    expect(info.totalHosts).toBe(1);
    expect(info.usableHosts).toBe(1);
    expect(info.firstUsable).toBe("2001:db8::1");
    expect(info.lastUsable).toBe("2001:db8::1");
  });
});
