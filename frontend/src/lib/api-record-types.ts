export type AllocationStatus = "Available" | "Allocated" | "Reserved";
export type AllocationPurpose = "Server" | "CDN" | "DNS" | "Customer" | "Infrastructure";

export type Allocation = {
  readonly id: string;
  readonly prefixId: string;
  readonly ipAddress: string;
  readonly assignee: string;
  readonly purpose: AllocationPurpose;
  readonly status: AllocationStatus;
  readonly assignedDate: string;
  readonly expiryDate: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AllocationPage = {
  readonly items: Allocation[];
  readonly nextCursor: string | null;
};

export type AllocationQueryParams = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: AllocationStatus | "all";
};

export type AllocationStatusCounts = Readonly<Record<AllocationStatus, number>>;

export type AllocationHeatmapBucket = {
  readonly capacity: import("./api-types").DecimalString;
  readonly counts: AllocationStatusCounts;
  readonly endAddress: string | null;
  readonly index: number;
  readonly startAddress: string | null;
};

export type AllocationHeatmap = {
  readonly bucketCount: 256;
  readonly buckets: AllocationHeatmapBucket[];
  readonly totalCapacity: import("./api-types").DecimalString;
};

export type AllocationUpdateInput = {
  readonly status?: AllocationStatus;
  readonly assignee?: string;
  readonly purpose?: AllocationPurpose;
  readonly notes?: string | null;
  readonly expiryDate?: string | null;
};

export type BulkAllocationUpdateInput = AllocationUpdateInput & {
  readonly allocationIds: string[];
};

export type BulkAllocationUpdateResponse = {
  readonly updated: number;
};

export type GeofeedValidation = "valid" | "warning" | "error";

export type GeofeedEntry = {
  readonly id: string;
  readonly prefix: string;
  readonly countryCode: string;
  readonly region: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly validation: GeofeedValidation;
  readonly validationMessage: string | null;
  readonly lastUpdated: string;
  readonly prefixId: string | null;
};

export type GeofeedPage = {
  readonly items: GeofeedEntry[];
  readonly nextCursor: string | null;
};

export type GeofeedQueryParams = {
  readonly search?: string;
  readonly countryCode?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type GeofeedImportError = {
  readonly line: number;
  readonly input: string;
  readonly message: string;
};

export type GeofeedImportResponse = {
  readonly imported: number;
  readonly failed: number;
  readonly errors: GeofeedImportError[];
};

export type GeofeedCreateInput = {
  readonly prefix: string;
  readonly countryCode: string;
  readonly region?: string | null;
  readonly city?: string | null;
  readonly postalCode?: string | null;
  readonly prefixId?: string | null;
};

export type GeofeedUpdateInput = {
  readonly countryCode?: string;
  readonly region?: string | null;
  readonly city?: string | null;
  readonly postalCode?: string | null;
  readonly prefixId?: string | null;
};

export type AuditAction = "Created" | "Updated" | "Deleted" | "Imported" | "Exported" | "Generated" | "Split";
export type AuditResourceType = "Prefix" | "Allocation" | "Geofeed" | "Settings" | "User" | "IPBlock" | "Subnet";

export type AuditFieldChange = {
  readonly field: string;
  readonly before: string;
  readonly after: string;
};

export type AuditSummaryChange = {
  readonly descendantCount: number;
  readonly allocationCount: number;
  readonly capped: boolean;
};

export type AuditChange = AuditFieldChange | AuditSummaryChange;

export type AuditEntry = {
  readonly id: string;
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId: string;
  readonly resourceLabel: string;
  readonly changes: AuditChange[] | null;
  readonly user: string;
};

export type AuditQueryParams = {
  readonly action?: AuditAction;
  readonly resourceType?: AuditResourceType;
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type AuditListResponse = {
  readonly items: AuditEntry[];
  readonly nextCursor: string | null;
};
