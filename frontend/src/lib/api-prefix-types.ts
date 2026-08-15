import type {DecimalString} from "./api-types";

export type PrefixStatus = "Active" | "Reserved" | "Available" | "Allocated" | "Deprecated";
export type PrefixRir = "APNIC" | "ARIN" | "RIPE" | "LACNIC" | "AFRINIC";
export type IPVersion = 4 | 6;

export type PrefixCounts = {
  readonly children: number;
  readonly allocations: number;
};

export type PrefixParent = {
  readonly id: string;
  readonly cidr: string;
};

export type PrefixRecord = {
  readonly id: string;
  readonly cidr: string;
  readonly version: IPVersion;
  readonly parentId: string | null;
  readonly status: PrefixStatus;
  readonly rir: PrefixRir | null;
  readonly vlan: number | null;
  readonly gateway: string | null;
  readonly assignedTo: string | null;
  readonly totalIPs: number;
  readonly usedIPs: number;
  readonly totalIPsExact: DecimalString;
  readonly usedIPsExact: DecimalString;
  readonly isPool: boolean;
  readonly depth: number;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly _count: PrefixCounts | undefined;
};

export type PrefixDetailResponse = PrefixRecord & {
  readonly parent: PrefixParent | null;
  readonly children: PrefixRecord[];
};

export type PrefixTreeNode = PrefixRecord & {
  readonly children: PrefixTreeNode[];
};

export type PrefixPage = {
  readonly items: PrefixRecord[];
  readonly nextCursor: string | null;
};

export type PrefixQueryParams = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly search?: string;
  readonly status?: PrefixStatus | "all";
  readonly version?: IPVersion;
};

export type PrefixCreateInput = {
  readonly cidr: string;
  readonly version?: IPVersion;
  readonly parentId?: string;
  readonly status?: PrefixStatus;
  readonly rir?: PrefixRir;
  readonly vlan?: number;
  readonly gateway?: string;
  readonly assignedTo?: string;
  readonly isPool?: boolean;
  readonly description?: string;
};

export type PrefixUpdateInput = {
  readonly status?: PrefixStatus;
  readonly rir?: PrefixRir | null;
  readonly vlan?: number | null;
  readonly gateway?: string | null;
  readonly assignedTo?: string | null;
  readonly isPool?: boolean;
  readonly description?: string;
};

export type PrefixSplitResponse = {
  readonly parent: PrefixRecord;
  readonly created: number;
};

export type GenerateIPsResponse = {
  readonly generated: number;
  readonly total: number;
};
