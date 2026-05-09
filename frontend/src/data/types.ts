// ============================================================================
// IPAM Data Types — Core domain models
// ============================================================================

export type RIR = "APNIC" | "ARIN" | "RIPE" | "LACNIC" | "AFRINIC";
export type IPVersion = 4 | 6;

// ------- IP Block -------
export type IPBlockStatus = "Active" | "Reserved" | "Deprecated";

export type IPBlock = {
  id: string;
  cidr: string;
  version: IPVersion;
  rir: RIR;
  status: IPBlockStatus;
  totalIPs: number;
  usedIPs: number;
  description: string;
  createdAt: string;
  updatedAt: string;
};

// ------- Subnet -------
export type SubnetStatus = "Allocated" | "Available" | "Reserved" | "Quarantine";

export type Subnet = {
  id: string;
  blockId: string;
  cidr: string;
  vlan?: number;
  gateway?: string;
  status: SubnetStatus;
  assignedTo?: string;
  totalIPs: number;
  usedIPs: number;
  description: string;
  createdAt: string;
  updatedAt: string;
};

// ------- Allocation -------
export type AllocationPurpose = "Server" | "CDN" | "DNS" | "Customer" | "Infrastructure";
export type AllocationStatus = "Active" | "Expired" | "Pending";

export type Allocation = {
  id: string;
  subnetId: string;
  ipAddress: string;
  assignee: string;
  purpose: AllocationPurpose;
  status: AllocationStatus;
  assignedDate: string;
  expiryDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// ------- Geofeed (RFC 8805) -------
export type GeofeedValidation = "valid" | "warning" | "error";

export type GeofeedEntry = {
  id: string;
  prefix: string;
  countryCode: string;
  region?: string;
  city?: string;
  postalCode?: string;
  validation: GeofeedValidation;
  validationMessage?: string;
  lastUpdated: string;
};

// ------- Audit Log -------
export type AuditAction = "Created" | "Updated" | "Deleted" | "Imported" | "Exported";
export type AuditResourceType = "IPBlock" | "Subnet" | "Allocation" | "Geofeed" | "Settings";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  resourceLabel: string;
  changes?: {
    field: string;
    before: string;
    after: string;
  }[];
  user: string;
};

// ------- Settings -------
export type AppSettings = {
  organizationName: string;
  asn: string;
  contactEmail: string;
  defaultRIR: RIR;
  geofeedHeader: string;
  geofeedAutoASN: boolean;
  defaultCountryCode: string;
  geofeedPublicUrl?: string;
  expiryWarningDays: number;
  utilizationThreshold: number;
};

// ------- Chip Color Maps -------
export const IP_BLOCK_STATUS_COLORS: Record<IPBlockStatus, "success" | "warning" | "danger"> = {
  Active: "success",
  Reserved: "warning",
  Deprecated: "danger",
};

export const SUBNET_STATUS_COLORS: Record<SubnetStatus, "success" | "accent" | "warning" | "danger"> = {
  Allocated: "success",
  Available: "accent",
  Reserved: "warning",
  Quarantine: "danger",
};

export const ALLOCATION_STATUS_COLORS: Record<AllocationStatus, "success" | "warning" | "danger"> = {
  Active: "success",
  Pending: "warning",
  Expired: "danger",
};

export const PURPOSE_COLORS: Record<AllocationPurpose, "accent" | "success" | "warning" | "danger" | "default"> = {
  Server: "accent",
  CDN: "success",
  DNS: "warning",
  Customer: "default",
  Infrastructure: "danger",
};

export const AUDIT_ACTION_COLORS: Record<AuditAction, "success" | "accent" | "danger" | "warning" | "default"> = {
  Created: "success",
  Updated: "accent",
  Deleted: "danger",
  Imported: "warning",
  Exported: "default",
};
