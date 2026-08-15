import type {DecimalString} from "./api-types";
import type {AuditEntry} from "./api-record-types";

export type DashboardTrendEntry = {
  readonly month: string;
  readonly ipv4: number;
  readonly ipv6: number;
};

export type DashboardRirDistribution = {
  readonly name: string;
  readonly value: number;
};

export type DashboardStats = {
  readonly totalCapacity: DecimalString;
  readonly usedCapacity: DecimalString;
  readonly utilizationBasisPoints: number;
  readonly totalIPv4: number;
  readonly usedIPv4: number;
  readonly utilizationRate: number;
  readonly ipv6Prefixes: number;
  readonly totalPrefixes: number;
  readonly rootPrefixes: number;
  readonly totalAllocations: number;
  readonly totalGeofeed: number;
  readonly prefixStatusCounts: Record<string, number>;
  readonly rirDistribution: DashboardRirDistribution[];
  readonly geofeedValid: number;
  readonly geofeedWarnings: number;
  readonly allocAvailable: number;
  readonly allocAllocated: number;
  readonly allocReserved: number;
  readonly recentAudit: AuditEntry[];
  readonly allocationTrend: DashboardTrendEntry[];
};

export type SettingsResponse = {
  readonly organizationName: string;
  readonly asn: string;
  readonly contactEmail: string;
  readonly defaultRIR: string;
  readonly geofeedHeader: string;
  readonly geofeedAutoASN: boolean;
  readonly defaultCountryCode: string;
  readonly geofeedPublicUrl: string | null;
  readonly expiryWarningDays: number;
  readonly utilizationThreshold: number;
  readonly version: string;
};

export type SettingsUpdateInput = {
  readonly organizationName?: string;
  readonly asn?: string;
  readonly contactEmail?: string;
  readonly defaultRIR?: string;
  readonly geofeedHeader?: string;
  readonly geofeedAutoASN?: boolean;
  readonly defaultCountryCode?: string;
  readonly geofeedPublicUrl?: string | null;
  readonly expiryWarningDays?: number;
  readonly utilizationThreshold?: number;
  readonly expectedVersion?: string;
};
