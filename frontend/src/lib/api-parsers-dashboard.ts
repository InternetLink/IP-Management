import {parseDecimalString, type DashboardStats, type SettingsResponse} from "./api-types";
import {array, boolean, fail, integer, nullableString, number, object, string} from "./api-parse-primitives";
import {parseAuditEntry} from "./api-parsers";

function parseIntegerMap(value: unknown, path: string): Record<string, number> {
  const record = object(value, path);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, integer(item, `${path}.${key}`)]));
}

export function parseDashboardStats(value: unknown): DashboardStats {
  const record = object(value, "dashboard");
  return {
    totalCapacity: parseDecimalString(record.totalCapacity, "dashboard.totalCapacity"),
    usedCapacity: parseDecimalString(record.usedCapacity, "dashboard.usedCapacity"),
    utilizationBasisPoints: integer(record.utilizationBasisPoints, "dashboard.utilizationBasisPoints"),
    totalIPv4: number(record.totalIPv4, "dashboard.totalIPv4"), usedIPv4: number(record.usedIPv4, "dashboard.usedIPv4"),
    utilizationRate: number(record.utilizationRate, "dashboard.utilizationRate"), ipv6Prefixes: integer(record.ipv6Prefixes, "dashboard.ipv6Prefixes"),
    totalPrefixes: integer(record.totalPrefixes, "dashboard.totalPrefixes"), rootPrefixes: integer(record.rootPrefixes, "dashboard.rootPrefixes"),
    totalAllocations: integer(record.totalAllocations, "dashboard.totalAllocations"), totalGeofeed: integer(record.totalGeofeed, "dashboard.totalGeofeed"),
    prefixStatusCounts: parseIntegerMap(record.prefixStatusCounts, "dashboard.prefixStatusCounts"),
    rirDistribution: array(record.rirDistribution, "dashboard.rirDistribution").map((item, index) => {
      const entry = object(item, `dashboard.rirDistribution[${index}]`);
      return {name: string(entry.name, `dashboard.rirDistribution[${index}].name`), value: number(entry.value, `dashboard.rirDistribution[${index}].value`)};
    }),
    geofeedValid: integer(record.geofeedValid, "dashboard.geofeedValid"), geofeedWarnings: integer(record.geofeedWarnings, "dashboard.geofeedWarnings"),
    allocAvailable: integer(record.allocAvailable, "dashboard.allocAvailable"), allocAllocated: integer(record.allocAllocated, "dashboard.allocAllocated"), allocReserved: integer(record.allocReserved, "dashboard.allocReserved"),
    recentAudit: array(record.recentAudit, "dashboard.recentAudit").map((item, index) => parseAuditEntry(item, `dashboard.recentAudit[${index}]`)),
    allocationTrend: array(record.allocationTrend, "dashboard.allocationTrend").map((item, index) => {
      const entry = object(item, `dashboard.allocationTrend[${index}]`);
      return {month: string(entry.month, `dashboard.allocationTrend[${index}].month`), ipv4: integer(entry.ipv4, `dashboard.allocationTrend[${index}].ipv4`), ipv6: integer(entry.ipv6, `dashboard.allocationTrend[${index}].ipv6`)};
    }),
  };
}

export function parseSettings(value: unknown): SettingsResponse {
  const record = object(value, "settings");
  const version = string(record.version, "settings.version");
  if (!/^[a-f0-9]{64}$/.test(version)) return fail("settings.version", "expected a SHA-256 hex string");
  return {
    organizationName: string(record.organizationName, "settings.organizationName"), asn: string(record.asn, "settings.asn"),
    contactEmail: string(record.contactEmail, "settings.contactEmail"), defaultRIR: string(record.defaultRIR, "settings.defaultRIR"),
    geofeedHeader: string(record.geofeedHeader, "settings.geofeedHeader"), geofeedAutoASN: boolean(record.geofeedAutoASN, "settings.geofeedAutoASN"),
    defaultCountryCode: string(record.defaultCountryCode, "settings.defaultCountryCode"), geofeedPublicUrl: nullableString(record.geofeedPublicUrl, "settings.geofeedPublicUrl"),
    expiryWarningDays: integer(record.expiryWarningDays, "settings.expiryWarningDays"), utilizationThreshold: integer(record.utilizationThreshold, "settings.utilizationThreshold"), version,
  };
}
