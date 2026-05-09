import { BadRequestException } from '@nestjs/common';

export type ParsedCIDR = {
  cidr: string;
  ip: bigint;
  prefixLen: number;
  version: 4 | 6;
  bits: 32 | 128;
};

const IPV4_BITS = 32;
const IPV6_BITS = 128;

export function parseCIDR(cidr: string): ParsedCIDR {
  if (typeof cidr !== 'string' || !cidr.includes('/')) {
    throw new BadRequestException('CIDR must include an address and prefix length');
  }

  const [address, length, extra] = cidr.trim().split('/');
  if (!address || !length || extra !== undefined) {
    throw new BadRequestException(`Invalid CIDR notation: ${cidr}`);
  }
  if (address !== address.trim() || length !== length.trim()) {
    throw new BadRequestException(`Invalid CIDR notation: ${cidr}`);
  }
  if (!/^(0|[1-9]\d*)$/.test(length)) {
    throw new BadRequestException(`Invalid prefix length: ${length}`);
  }

  const prefixLen = Number(length);

  if (address.includes(':')) {
    if (prefixLen < 0 || prefixLen > IPV6_BITS) {
      throw new BadRequestException('IPv6 prefix length must be between 0 and 128');
    }
    const ip = ipv6ToBigInt(address);
    const network = networkStart(ip, prefixLen, IPV6_BITS);
    return {
      cidr: `${bigIntToIPv6(network)}/${prefixLen}`,
      ip: network,
      prefixLen,
      version: 6,
      bits: IPV6_BITS,
    };
  }

  if (prefixLen < 0 || prefixLen > IPV4_BITS) {
    throw new BadRequestException('IPv4 prefix length must be between 0 and 32');
  }
  const ip = ipv4ToBigInt(address);
  const network = networkStart(ip, prefixLen, IPV4_BITS);
  return {
    cidr: `${bigIntToIPv4(network)}/${prefixLen}`,
    ip: network,
    prefixLen,
    version: 4,
    bits: IPV4_BITS,
  };
}

export function ipv4ToBigInt(address: string): bigint {
  const parts = address.split('.');
  if (parts.length !== 4) throw new BadRequestException(`Invalid IPv4 address: ${address}`);

  return parts.reduce((acc, part) => {
    if (!/^\d+$/.test(part)) throw new BadRequestException(`Invalid IPv4 address: ${address}`);
    if (part.length > 1 && part.startsWith('0')) throw new BadRequestException(`Invalid IPv4 address: ${address}`);
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new BadRequestException(`Invalid IPv4 address: ${address}`);
    }
    return (acc << 8n) + BigInt(n);
  }, 0n);
}

export function ipv6ToBigInt(address: string): bigint {
  if (!address || address.includes(':::')) throw new BadRequestException(`Invalid IPv6 address: ${address}`);
  if ((address.match(/::/g) ?? []).length > 1) throw new BadRequestException(`Invalid IPv6 address: ${address}`);

  const halves = address.toLowerCase().split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  if (halves.length === 1 && left.length !== 8) throw new BadRequestException(`Invalid IPv6 address: ${address}`);
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 1) throw new BadRequestException(`Invalid IPv6 address: ${address}`);

  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8) throw new BadRequestException(`Invalid IPv6 address: ${address}`);

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) throw new BadRequestException(`Invalid IPv6 address: ${address}`);
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  return result;
}

export function bigIntToIPv4(ip: bigint): string {
  if (ip < 0n || ip > 0xffffffffn) throw new BadRequestException('IPv4 value out of range');
  return [
    Number((ip >> 24n) & 0xffn),
    Number((ip >> 16n) & 0xffn),
    Number((ip >> 8n) & 0xffn),
    Number(ip & 0xffn),
  ].join('.');
}

export function bigIntToIPv6(ip: bigint): string {
  if (ip < 0n || ip >= (1n << 128n)) throw new BadRequestException('IPv6 value out of range');
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((ip >> BigInt(i * 16)) & 0xffffn).toString(16));
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    const start = i;
    while (i < groups.length && groups[i] === '0') i++;
    const length = i - start;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }

  if (bestLength < 2) return groups.join(':');

  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLength).join(':');
  if (!left && !right) return '::';
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

export function cidrContains(parent: string, child: string): boolean {
  const p = parseCIDR(parent);
  const c = parseCIDR(child);
  if (p.version !== c.version || c.prefixLen <= p.prefixLen) return false;
  return rangeStart(p) <= rangeStart(c) && rangeEnd(p) >= rangeEnd(c);
}

export function cidrOverlaps(a: string, b: string): boolean {
  const pa = parseCIDR(a);
  const pb = parseCIDR(b);
  if (pa.version !== pb.version) return false;
  return rangeStart(pa) <= rangeEnd(pb) && rangeStart(pb) <= rangeEnd(pa);
}

export function countIPv4(cidr: string): number {
  const parsed = parseCIDR(cidr);
  if (parsed.version !== 4) return -1;
  return 2 ** (IPV4_BITS - parsed.prefixLen);
}

export function formatIP(ip: bigint, version: 4 | 6): string {
  return version === 4 ? bigIntToIPv4(ip) : bigIntToIPv6(ip);
}

export function ipSortValue(address: string): bigint {
  return address.includes(':') ? ipv6ToBigInt(address) : ipv4ToBigInt(address);
}

function rangeStart(parsed: ParsedCIDR): bigint {
  return networkStart(parsed.ip, parsed.prefixLen, parsed.bits);
}

function rangeEnd(parsed: ParsedCIDR): bigint {
  const hostBits = BigInt(parsed.bits - parsed.prefixLen);
  return rangeStart(parsed) + ((1n << hostBits) - 1n);
}

function networkStart(ip: bigint, prefixLen: number, bits: 32 | 128): bigint {
  const hostBits = BigInt(bits - prefixLen);
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << hostBits) - 1n);
  return ip & mask;
}
