export type DecimalString = string & {
  readonly __decimalStringBrand: unique symbol;
};

export type ApiClientErrorKind = "http" | "payload";

export class ApiClientError extends Error {
  readonly name: string = "ApiClientError";

  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly kind: ApiClientErrorKind = "http",
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export class ApiPayloadError extends ApiClientError {
  readonly name = "ApiPayloadError";

  constructor(path: string, message: string) {
    super(`Invalid API response at ${path}: ${message}`, null, "INVALID_RESPONSE", "payload");
  }
}

export function parseDecimalString(value: unknown, path = "decimal"): DecimalString {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ApiPayloadError(path, "expected a non-negative decimal string");
  }
  return value as DecimalString;
}

export type ApiAuthUser = {
  readonly email: string | null;
  readonly id: string;
  readonly role: string;
  readonly username: string;
};

export type ApiAuthStatusResponse = {
  readonly hasUsers: boolean;
};

export type ApiLoginResponse = {
  readonly user: ApiAuthUser;
};

export type ApiOkResponse = {
  readonly ok: true;
};

export type ApiDeletedResponse = {
  readonly deleted: true;
};

export type {
  GenerateIPsResponse,
  IPVersion,
  PrefixCounts,
  PrefixCreateInput,
  PrefixDetailResponse,
  PrefixParent,
  PrefixPage,
  PrefixQueryParams,
  PrefixRecord,
  PrefixRir,
  PrefixSplitResponse,
  PrefixStatus,
  PrefixTreeNode,
  PrefixUpdateInput,
} from "./api-prefix-types";

export type {
  Allocation,
  AllocationHeatmap,
  AllocationHeatmapBucket,
  AllocationPage,
  AllocationPurpose,
  AllocationQueryParams,
  AllocationStatus,
  AllocationStatusCounts,
  AllocationUpdateInput,
  AuditAction,
  AuditChange,
  AuditEntry,
  AuditFieldChange,
  AuditListResponse,
  AuditQueryParams,
  AuditResourceType,
  AuditSummaryChange,
  BulkAllocationUpdateInput,
  BulkAllocationUpdateResponse,
  GeofeedCreateInput,
  GeofeedEntry,
  GeofeedImportError,
  GeofeedImportResponse,
  GeofeedPage,
  GeofeedQueryParams,
  GeofeedUpdateInput,
  GeofeedValidation,
} from "./api-record-types";

export type {
  DashboardRirDistribution,
  DashboardStats,
  DashboardTrendEntry,
  SettingsResponse,
  SettingsUpdateInput,
} from "./api-dashboard-types";
