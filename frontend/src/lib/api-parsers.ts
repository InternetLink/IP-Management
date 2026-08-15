import {
  parseDecimalString,
  type Allocation,
  type AllocationHeatmap,
  type AllocationHeatmapBucket,
  type AllocationPage,
  type AllocationStatusCounts,
  type ApiAuthStatusResponse,
  type ApiAuthUser,
  type ApiDeletedResponse,
  type ApiLoginResponse,
  type ApiOkResponse,
  type AuditChange,
  type AuditEntry,
  type AuditListResponse,
  type BulkAllocationUpdateResponse,
  type GenerateIPsResponse,
  type GeofeedEntry,
  type GeofeedImportError,
  type GeofeedImportResponse,
  type GeofeedPage,
  type PrefixCounts,
  type PrefixDetailResponse,
  type PrefixParent,
  type PrefixPage,
  type PrefixRecord,
  type PrefixRir,
  type PrefixSplitResponse,
  type PrefixStatus,
  type PrefixTreeNode,
} from "./api-types";
import {array, boolean, enumValue, fail, integer, nullableEnum, nullableInteger, nullableString, number, object, string} from "./api-parse-primitives";

function parseCounts(value: unknown, path: string): PrefixCounts {
  const record = object(value, path);
  return {children: integer(record.children, `${path}.children`), allocations: integer(record.allocations, `${path}.allocations`)};
}

const PREFIX_STATUSES: readonly PrefixStatus[] = ["Active", "Reserved", "Available", "Allocated", "Deprecated"];
const PREFIX_RIRS: readonly PrefixRir[] = ["APNIC", "ARIN", "RIPE", "LACNIC", "AFRINIC"];
const ALLOCATION_STATUSES = ["Available", "Allocated", "Reserved"] as const;
const ALLOCATION_PURPOSES = ["Server", "CDN", "DNS", "Customer", "Infrastructure"] as const;
const GEOFEED_VALIDATIONS = ["valid", "warning", "error"] as const;
const AUDIT_ACTIONS = ["Created", "Updated", "Deleted", "Imported", "Exported", "Generated", "Split"] as const;
const AUDIT_RESOURCE_TYPES = ["Prefix", "Allocation", "Geofeed", "Settings", "User", "IPBlock", "Subnet"] as const;

export function parseAuthUser(value: unknown, path = "user"): ApiAuthUser {
  const record = object(value, path);
  return {
    id: string(record.id, `${path}.id`), username: string(record.username, `${path}.username`),
    email: nullableString(record.email, `${path}.email`), role: string(record.role, `${path}.role`),
  };
}

export function parseAuthStatus(value: unknown): ApiAuthStatusResponse {
  const record = object(value, "auth.status");
  return {hasUsers: boolean(record.hasUsers, "auth.status.hasUsers")};
}

export function parseLoginResponse(value: unknown): ApiLoginResponse {
  return {user: parseAuthUser(object(value, "auth.login").user, "auth.login.user")};
}

export function parseOkResponse(value: unknown): ApiOkResponse {
  const record = object(value, "response");
  if (record.ok !== true) return fail("response.ok", "expected true");
  return {ok: true};
}

export function parseDeletedResponse(value: unknown): ApiDeletedResponse {
  const record = object(value, "response");
  if (record.deleted !== true) return fail("response.deleted", "expected true");
  return {deleted: true};
}

export function parsePrefixRecord(value: unknown, path = "prefix"): PrefixRecord {
  const record = object(value, path);
  const version = integer(record.version, `${path}.version`);
  if (version !== 4 && version !== 6) return fail(`${path}.version`, "expected 4 or 6");
  return {
    id: string(record.id, `${path}.id`), cidr: string(record.cidr, `${path}.cidr`), version,
    parentId: nullableString(record.parentId, `${path}.parentId`),
    status: enumValue(record.status, PREFIX_STATUSES, `${path}.status`),
    rir: nullableEnum(record.rir, PREFIX_RIRS, `${path}.rir`),
    vlan: nullableInteger(record.vlan, `${path}.vlan`), gateway: nullableString(record.gateway, `${path}.gateway`),
    assignedTo: nullableString(record.assignedTo, `${path}.assignedTo`),
    totalIPs: number(record.totalIPs, `${path}.totalIPs`), usedIPs: number(record.usedIPs, `${path}.usedIPs`),
    totalIPsExact: parseDecimalString(record.totalIPsExact, `${path}.totalIPsExact`),
    usedIPsExact: parseDecimalString(record.usedIPsExact, `${path}.usedIPsExact`),
    isPool: boolean(record.isPool, `${path}.isPool`), depth: integer(record.depth, `${path}.depth`),
    description: string(record.description, `${path}.description`),
    createdAt: string(record.createdAt, `${path}.createdAt`), updatedAt: string(record.updatedAt, `${path}.updatedAt`),
    _count: record._count === undefined ? undefined : parseCounts(record._count, `${path}._count`),
  };
}

export function parsePrefixList(value: unknown): PrefixPage {
  const record = object(value, "prefix.page");
  return {
    items: array(record.items, "prefix.page.items").map((item, index) => parsePrefixRecord(item, `prefix.page.items[${index}]`)),
    nextCursor: nullableString(record.nextCursor, "prefix.page.nextCursor"),
  };
}

function parsePrefixParent(value: unknown, path: string): PrefixParent {
  const record = object(value, path);
  return {id: string(record.id, `${path}.id`), cidr: string(record.cidr, `${path}.cidr`)};
}

export function parsePrefixDetail(value: unknown): PrefixDetailResponse {
  const record = object(value, "prefix.detail");
  return {
    ...parsePrefixRecord(record, "prefix.detail"),
    parent: record.parent === null ? null : parsePrefixParent(record.parent, "prefix.detail.parent"),
    children: array(record.children, "prefix.detail.children").map((item, index) => parsePrefixRecord(item, `prefix.detail.children[${index}]`)),
  };
}

export function parsePrefixTree(value: unknown): PrefixTreeNode {
  const record = object(value, "prefix.tree");
  return {
    ...parsePrefixRecord(record, "prefix.tree"),
    children: array(record.children, "prefix.tree.children").map((item, index) => parsePrefixTreeNode(item, `prefix.tree.children[${index}]`)),
  };
}

function parsePrefixTreeNode(value: unknown, path: string): PrefixTreeNode {
  const record = object(value, path);
  return {
    ...parsePrefixRecord(record, path),
    children: array(record.children, `${path}.children`).map((item, index) => parsePrefixTreeNode(item, `${path}.children[${index}]`)),
  };
}

export function parsePrefixSplit(value: unknown): PrefixSplitResponse {
  const record = object(value, "prefix.split");
  return {parent: parsePrefixRecord(record.parent, "prefix.split.parent"), created: integer(record.created, "prefix.split.created")};
}

export function parseGenerateIPs(value: unknown): GenerateIPsResponse {
  const record = object(value, "prefix.generateIPs");
  return {generated: integer(record.generated, "prefix.generateIPs.generated"), total: integer(record.total, "prefix.generateIPs.total")};
}

export function parseAllocation(value: unknown, path = "allocation"): Allocation {
  const record = object(value, path);
  return {
    id: string(record.id, `${path}.id`), prefixId: string(record.prefixId, `${path}.prefixId`),
    ipAddress: string(record.ipAddress, `${path}.ipAddress`), assignee: string(record.assignee, `${path}.assignee`),
    purpose: enumValue(record.purpose, ALLOCATION_PURPOSES, `${path}.purpose`),
    status: enumValue(record.status, ALLOCATION_STATUSES, `${path}.status`),
    assignedDate: string(record.assignedDate, `${path}.assignedDate`),
    expiryDate: nullableString(record.expiryDate, `${path}.expiryDate`), notes: nullableString(record.notes, `${path}.notes`),
    createdAt: string(record.createdAt, `${path}.createdAt`), updatedAt: string(record.updatedAt, `${path}.updatedAt`),
  };
}

export function parseAllocationList(value: unknown): AllocationPage {
  const record = object(value, "allocation.page");
  return {
    items: array(record.items, "allocation.page.items").map((item, index) => parseAllocation(item, `allocation.page.items[${index}]`)),
    nextCursor: nullableString(record.nextCursor, "allocation.page.nextCursor"),
  };
}

export function parseAllocationStatusCounts(value: unknown, path = "allocation.statusCounts"): AllocationStatusCounts {
  const record = object(value, path);
  return {
    Available: integer(record.Available, `${path}.Available`),
    Allocated: integer(record.Allocated, `${path}.Allocated`),
    Reserved: integer(record.Reserved, `${path}.Reserved`),
  };
}

function parseAllocationHeatmapBucket(value: unknown, path: string): AllocationHeatmapBucket {
  const record = object(value, path);
  return {
    capacity: parseDecimalString(record.capacity, `${path}.capacity`),
    counts: parseAllocationStatusCounts(record.counts, `${path}.counts`),
    endAddress: nullableString(record.endAddress, `${path}.endAddress`),
    index: integer(record.index, `${path}.index`),
    startAddress: nullableString(record.startAddress, `${path}.startAddress`),
  };
}

export function parseAllocationHeatmap(value: unknown): AllocationHeatmap {
  const record = object(value, "allocation.heatmap");
  const bucketCount = integer(record.bucketCount, "allocation.heatmap.bucketCount");
  if (bucketCount !== 256) return fail("allocation.heatmap.bucketCount", "expected 256");
  const buckets = array(record.buckets, "allocation.heatmap.buckets")
    .map((item, index) => parseAllocationHeatmapBucket(item, `allocation.heatmap.buckets[${index}]`));
  if (buckets.length !== bucketCount) return fail("allocation.heatmap.buckets", "expected 256 buckets");
  return {
    bucketCount,
    buckets,
    totalCapacity: parseDecimalString(record.totalCapacity, "allocation.heatmap.totalCapacity"),
  };
}

export function parseBulkAllocationUpdate(value: unknown): BulkAllocationUpdateResponse {
  const record = object(value, "allocation.bulkUpdate");
  return {updated: integer(record.updated, "allocation.bulkUpdate.updated")};
}

export function parseGeofeedEntry(value: unknown, path = "geofeed.entry"): GeofeedEntry {
  const record = object(value, path);
  return {
    id: string(record.id, `${path}.id`), prefix: string(record.prefix, `${path}.prefix`),
    countryCode: string(record.countryCode, `${path}.countryCode`), region: nullableString(record.region, `${path}.region`),
    city: nullableString(record.city, `${path}.city`), postalCode: nullableString(record.postalCode, `${path}.postalCode`),
    validation: enumValue(record.validation, GEOFEED_VALIDATIONS, `${path}.validation`),
    validationMessage: nullableString(record.validationMessage, `${path}.validationMessage`),
    lastUpdated: string(record.lastUpdated, `${path}.lastUpdated`), prefixId: nullableString(record.prefixId, `${path}.prefixId`),
  };
}

export function parseGeofeedPage(value: unknown): GeofeedPage {
  const record = object(value, "geofeed.page");
  return {
    items: array(record.items, "geofeed.page.items").map((item, index) => parseGeofeedEntry(item, `geofeed.page.items[${index}]`)),
    nextCursor: nullableString(record.nextCursor, "geofeed.page.nextCursor"),
  };
}

function parseGeofeedImportError(value: unknown, path: string): GeofeedImportError {
  const record = object(value, path);
  return {line: integer(record.line, `${path}.line`), input: string(record.input, `${path}.input`), message: string(record.message, `${path}.message`)};
}

export function parseGeofeedImport(value: unknown): GeofeedImportResponse {
  const record = object(value, "geofeed.import");
  return {
    imported: integer(record.imported, "geofeed.import.imported"), failed: integer(record.failed, "geofeed.import.failed"),
    errors: array(record.errors, "geofeed.import.errors").map((item, index) => parseGeofeedImportError(item, `geofeed.import.errors[${index}]`)),
  };
}

function parseAuditChange(value: unknown, path: string): AuditChange {
  const record = object(value, path);
  if (typeof record.field === "string" && typeof record.before === "string" && typeof record.after === "string") {
    return {field: record.field, before: record.before, after: record.after};
  }
  if (typeof record.descendantCount === "number" && typeof record.allocationCount === "number" && typeof record.capped === "boolean") {
    return {descendantCount: integer(record.descendantCount, `${path}.descendantCount`), allocationCount: integer(record.allocationCount, `${path}.allocationCount`), capped: record.capped};
  }
  return fail(path, "unsupported audit change shape");
}

export function parseAuditEntry(value: unknown, path = "audit.entry"): AuditEntry {
  const record = object(value, path);
  const changes = record.changes === null ? null : array(record.changes, `${path}.changes`).map((item, index) => parseAuditChange(item, `${path}.changes[${index}]`));
  return {
    id: string(record.id, `${path}.id`), timestamp: string(record.timestamp, `${path}.timestamp`),
    action: enumValue(record.action, AUDIT_ACTIONS, `${path}.action`),
    resourceType: enumValue(record.resourceType, AUDIT_RESOURCE_TYPES, `${path}.resourceType`),
    resourceId: string(record.resourceId, `${path}.resourceId`), resourceLabel: string(record.resourceLabel, `${path}.resourceLabel`),
    changes, user: string(record.user, `${path}.user`),
  };
}

export function parseAuditList(value: unknown): AuditListResponse {
  const record = object(value, "audit.page");
  return {
    items: array(record.items, "audit.page.items").map((item, index) => parseAuditEntry(item, `audit.page.items[${index}]`)),
    nextCursor: nullableString(record.nextCursor, "audit.page.nextCursor"),
  };
}

export function parseVoid(): void {}
