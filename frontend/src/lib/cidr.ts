// ============================================================================
// CIDR Calculation Engine — Pure frontend IP math
// Supports both IPv4 and IPv6
// ============================================================================

/** Parse a CIDR string into its components */
export function parseCidr(cidr: string): {
  ip: string;
  prefix: number;
  version: 4 | 6;
} | null {
  const parts = cidr.trim().split("/");
  if (parts.length !== 2) return null;
  const prefix = parseInt(parts[1], 10);
  if (isNaN(prefix)) return null;

  const ip = parts[0];
  const version = ip.includes(":") ? 6 : 4;

  if (version === 4) {
    if (prefix < 0 || prefix > 32) return null;
    if (!isValidIPv4(ip)) return null;
  } else {
    if (prefix < 0 || prefix > 128) return null;
    if (!isValidIPv6(ip)) return null;
  }

  return { ip, prefix, version };
}

export function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

export function isValidIPv6(ip: string): boolean {
  // Simplified validation — allows :: shorthand
  const expanded = expandIPv6(ip);
  if (!expanded) return false;
  const parts = expanded.split(":");
  if (parts.length !== 8) return false;
  return parts.every((p) => /^[0-9a-fA-F]{1,4}$/.test(p));
}

export function expandIPv6(ip: string): string | null {
  if (ip.includes("::")) {
    const halves = ip.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    const middle = Array(missing).fill("0");
    return [...left, ...middle, ...right].join(":");
  }
  return ip;
}

/** Convert IPv4 string to 32-bit number using safe multiplication */
export function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  // Use multiplication instead of bitwise shift to avoid 32-bit signed overflow
  return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3];
}

/** Convert number back to IPv4 string */
export function numberToIPv4(num: number): string {
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ].join(".");
}

/** Convert IPv6 string to BigInt */
export function ipv6ToBigInt(ip: string): bigint {
  const expanded = expandIPv6(ip);
  if (!expanded) return 0n;
  const parts = expanded.split(":");
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) + BigInt(parseInt(part, 16));
  }
  return result;
}

/** Convert BigInt back to IPv6 string (compressed) */
export function bigIntToIPv6(num: bigint): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    parts.unshift((num & 0xffffn).toString(16));
    num >>= 16n;
  }
  // Compress consecutive zero groups
  const full = parts.join(":");
  const compressed = full
    .replace(/\b0+/g, "")
    .replace(/(^|:)0(:0)*(:|$)/, "::")
    .replace(/:{3,}/, "::");
  return compressed || "::";
}

/** Get detailed subnet info from a CIDR */
export interface SubnetInfo {
  cidr: string;
  version: 4 | 6;
  networkAddress: string;
  broadcastAddress: string;
  firstUsable: string;
  lastUsable: string;
  subnetMask: string;
  wildcardMask: string;
  totalHosts: number;
  usableHosts: number;
  prefix: number;
  ipClass?: string;
}

export function getSubnetInfo(cidr: string): SubnetInfo | null {
  const parsed = parseCidr(cidr);
  if (!parsed) return null;

  if (parsed.version === 4) {
    return getIPv4SubnetInfo(parsed.ip, parsed.prefix);
  }
  return getIPv6SubnetInfo(parsed.ip, parsed.prefix);
}

function getIPv4SubnetInfo(ip: string, prefix: number): SubnetInfo {
  const ipNum = ipv4ToNumber(ip);
  const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1) >>> 0;
  const network = (ipNum & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  const totalHosts = Math.pow(2, 32 - prefix);
  const usableHosts = prefix <= 30 ? totalHosts - 2 : totalHosts;

  // IP Class
  const firstOctet = (network >>> 24) & 0xff;
  let ipClass = "N/A";
  if (firstOctet < 128) ipClass = "A";
  else if (firstOctet < 192) ipClass = "B";
  else if (firstOctet < 224) ipClass = "C";
  else if (firstOctet < 240) ipClass = "D (Multicast)";
  else ipClass = "E (Reserved)";

  return {
    cidr: `${numberToIPv4(network)}/${prefix}`,
    version: 4,
    networkAddress: numberToIPv4(network),
    broadcastAddress: numberToIPv4(broadcast),
    firstUsable: prefix <= 30 ? numberToIPv4(network + 1) : numberToIPv4(network),
    lastUsable: prefix <= 30 ? numberToIPv4(broadcast - 1) : numberToIPv4(broadcast),
    subnetMask: numberToIPv4(mask >>> 0),
    wildcardMask: numberToIPv4((~mask) >>> 0),
    totalHosts,
    usableHosts: Math.max(0, usableHosts),
    prefix,
    ipClass,
  };
}

function getIPv6SubnetInfo(ip: string, prefix: number): SubnetInfo {
  const ipBig = ipv6ToBigInt(ip);
  const maskBig = prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - prefix);
  const network = ipBig & maskBig;
  const hostBits = 128 - prefix;
  const broadcast = network | ((1n << BigInt(hostBits)) - 1n);
  const totalHosts = Number(hostBits > 53 ? 2n ** BigInt(hostBits) : 2 ** hostBits);

  return {
    cidr: `${bigIntToIPv6(network)}/${prefix}`,
    version: 6,
    networkAddress: bigIntToIPv6(network),
    broadcastAddress: bigIntToIPv6(broadcast),
    firstUsable: bigIntToIPv6(network + 1n),
    lastUsable: bigIntToIPv6(broadcast - 1n),
    subnetMask: `/${prefix}`,
    wildcardMask: `/${128 - prefix} host bits`,
    totalHosts,
    usableHosts: Math.max(0, totalHosts - 2),
    prefix,
  };
}

/** Check if two CIDRs overlap */
export function isOverlapping(cidr1: string, cidr2: string): boolean {
  const a = parseCidr(cidr1);
  const b = parseCidr(cidr2);
  if (!a || !b || a.version !== b.version) return false;

  if (a.version === 4) {
    const aNet = ipv4ToNumber(a.ip);
    const bNet = ipv4ToNumber(b.ip);
    const aMask = a.prefix === 0 ? 0 : ~((1 << (32 - a.prefix)) - 1) >>> 0;
    const bMask = b.prefix === 0 ? 0 : ~((1 << (32 - b.prefix)) - 1) >>> 0;
    const aStart = (aNet & aMask) >>> 0;
    const aEnd = (aStart | ~aMask) >>> 0;
    const bStart = (bNet & bMask) >>> 0;
    const bEnd = (bStart | ~bMask) >>> 0;
    return aStart <= bEnd && bStart <= aEnd;
  } else {
    const aNet = ipv6ToBigInt(a.ip);
    const bNet = ipv6ToBigInt(b.ip);
    const aMask = a.prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - a.prefix);
    const bMask = b.prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - b.prefix);
    const aStart = aNet & aMask;
    const aEnd = aStart | ((1n << BigInt(128 - a.prefix)) - 1n);
    const bStart = bNet & bMask;
    const bEnd = bStart | ((1n << BigInt(128 - b.prefix)) - 1n);
    return aStart <= bEnd && bStart <= aEnd;
  }
}

/** Check if child CIDR is a subset of parent CIDR */
export function isSubsetOf(child: string, parent: string): boolean {
  const c = parseCidr(child);
  const p = parseCidr(parent);
  if (!c || !p || c.version !== p.version) return false;
  if (c.prefix < p.prefix) return false; // child is larger

  if (c.version === 4) {
    const cNet = ipv4ToNumber(c.ip);
    const pNet = ipv4ToNumber(p.ip);
    const pMask = p.prefix === 0 ? 0 : ~((1 << (32 - p.prefix)) - 1) >>> 0;
    return ((cNet & pMask) >>> 0) === ((pNet & pMask) >>> 0);
  } else {
    const cNet = ipv6ToBigInt(c.ip);
    const pNet = ipv6ToBigInt(p.ip);
    const pMask = p.prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - p.prefix);
    return (cNet & pMask) === (pNet & pMask);
  }
}

/** Split a CIDR into smaller subnets */
export function splitCidr(cidr: string, newPrefix: number): string[] {
  const parsed = parseCidr(cidr);
  if (!parsed) return [];
  if (newPrefix <= parsed.prefix) return [cidr];

  const maxPrefix = parsed.version === 4 ? 32 : 128;
  if (newPrefix > maxPrefix) return [];

  const results: string[] = [];
  const count = Math.pow(2, newPrefix - parsed.prefix);

  if (parsed.version === 4) {
    const baseNet = ipv4ToNumber(parsed.ip);
    const mask = parsed.prefix === 0 ? 0 : ~((1 << (32 - parsed.prefix)) - 1) >>> 0;
    const start = (baseNet & mask) >>> 0;
    const step = Math.pow(2, 32 - newPrefix);
    for (let i = 0; i < count; i++) {
      results.push(`${numberToIPv4(start + i * step)}/${newPrefix}`);
    }
  } else {
    const baseNet = ipv6ToBigInt(parsed.ip);
    const maskBig = parsed.prefix === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - parsed.prefix);
    const start = baseNet & maskBig;
    const step = 1n << BigInt(128 - newPrefix);
    for (let i = 0; i < count; i++) {
      results.push(`${bigIntToIPv6(start + BigInt(i) * step)}/${newPrefix}`);
    }
  }

  return results;
}

/** Detect conflicts between a new CIDR and existing CIDRs */
export type ConflictType = "exact_duplicate" | "overlapping" | "subset" | "superset";
export interface ConflictResult {
  existingCidr: string;
  type: ConflictType;
}

export function detectConflicts(
  newCidr: string,
  existingCidrs: string[]
): ConflictResult[] {
  const results: ConflictResult[] = [];
  const newParsed = parseCidr(newCidr);
  if (!newParsed) return results;

  for (const existing of existingCidrs) {
    if (newCidr === existing) {
      results.push({ existingCidr: existing, type: "exact_duplicate" });
    } else if (isSubsetOf(newCidr, existing)) {
      results.push({ existingCidr: existing, type: "subset" });
    } else if (isSubsetOf(existing, newCidr)) {
      results.push({ existingCidr: existing, type: "superset" });
    } else if (isOverlapping(newCidr, existing)) {
      results.push({ existingCidr: existing, type: "overlapping" });
    }
  }

  return results;
}

/** Calculate total IPs for a given prefix */
export function totalIPsForPrefix(prefix: number, version: 4 | 6): number {
  const maxBits = version === 4 ? 32 : 128;
  const hostBits = maxBits - prefix;
  if (hostBits > 53) return Infinity; // Too large for JS number
  return Math.pow(2, hostBits);
}

/** Format IP count for display */
export function formatIPCount(count: number): string {
  if (count === Infinity) return "∞";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

/** Validate a CIDR string and return error messages */
export function validateCidr(cidr: string): { valid: boolean; error?: string } {
  if (!cidr || !cidr.trim()) return { valid: false, error: "CIDR is required" };

  const trimmed = cidr.trim();
  if (!trimmed.includes("/"))
    return { valid: false, error: "Missing prefix length (e.g. /24)" };

  const parsed = parseCidr(trimmed);
  if (!parsed) return { valid: false, error: "Invalid CIDR format" };

  return { valid: true };
}
