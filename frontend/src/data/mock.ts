import type { IPBlock, Subnet, Allocation, GeofeedEntry, AuditEntry, AppSettings } from "./types";

export const MOCK_IP_BLOCKS: IPBlock[] = [
  { id: "b1", cidr: "103.152.220.0/22", version: 4, rir: "APNIC", status: "Active", totalIPs: 1024, usedIPs: 768, description: "Primary production block - APNIC allocation", createdAt: "2024-01-15T00:00:00Z", updatedAt: "2026-04-20T00:00:00Z" },
  { id: "b2", cidr: "45.131.68.0/22", version: 4, rir: "RIPE", status: "Active", totalIPs: 1024, usedIPs: 512, description: "European PoP allocation", createdAt: "2024-03-10T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" },
  { id: "b3", cidr: "198.51.100.0/24", version: 4, rir: "ARIN", status: "Active", totalIPs: 256, usedIPs: 200, description: "US West Coast CDN", createdAt: "2024-06-01T00:00:00Z", updatedAt: "2026-03-15T00:00:00Z" },
  { id: "b4", cidr: "203.0.113.0/24", version: 4, rir: "APNIC", status: "Reserved", totalIPs: 256, usedIPs: 0, description: "Reserved for future expansion", createdAt: "2025-01-10T00:00:00Z", updatedAt: "2025-01-10T00:00:00Z" },
  { id: "b5", cidr: "192.0.2.0/24", version: 4, rir: "ARIN", status: "Deprecated", totalIPs: 256, usedIPs: 32, description: "Legacy block - migrating off", createdAt: "2022-08-20T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" },
  { id: "b6", cidr: "2001:db8::/32", version: 6, rir: "APNIC", status: "Active", totalIPs: Infinity, usedIPs: 16, description: "Primary IPv6 allocation", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2026-04-22T00:00:00Z" },
  { id: "b7", cidr: "2001:db8:1::/48", version: 6, rir: "RIPE", status: "Active", totalIPs: Infinity, usedIPs: 8, description: "European IPv6 PoP", createdAt: "2024-05-15T00:00:00Z", updatedAt: "2026-04-10T00:00:00Z" },
  { id: "b8", cidr: "2001:db8:2::/48", version: 6, rir: "ARIN", status: "Reserved", totalIPs: Infinity, usedIPs: 0, description: "Reserved IPv6 block", createdAt: "2025-03-01T00:00:00Z", updatedAt: "2025-03-01T00:00:00Z" },
];

export const MOCK_SUBNETS: Subnet[] = [
  { id: "s1", blockId: "b1", cidr: "103.152.220.0/24", vlan: 100, gateway: "103.152.220.1", status: "Allocated", assignedTo: "Web Cluster A", totalIPs: 256, usedIPs: 230, description: "Production web servers", createdAt: "2024-01-20T00:00:00Z", updatedAt: "2026-04-20T00:00:00Z" },
  { id: "s2", blockId: "b1", cidr: "103.152.221.0/24", vlan: 101, gateway: "103.152.221.1", status: "Allocated", assignedTo: "Database Tier", totalIPs: 256, usedIPs: 180, description: "Database servers", createdAt: "2024-01-20T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" },
  { id: "s3", blockId: "b1", cidr: "103.152.222.0/24", vlan: 102, gateway: "103.152.222.1", status: "Allocated", assignedTo: "CDN Edge", totalIPs: 256, usedIPs: 210, description: "CDN edge nodes", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2026-04-15T00:00:00Z" },
  { id: "s4", blockId: "b1", cidr: "103.152.223.0/25", vlan: 103, gateway: "103.152.223.1", status: "Available", totalIPs: 128, usedIPs: 0, description: "Available for allocation", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2024-02-01T00:00:00Z" },
  { id: "s5", blockId: "b1", cidr: "103.152.223.128/25", vlan: 104, gateway: "103.152.223.129", status: "Reserved", assignedTo: "DR Site", totalIPs: 128, usedIPs: 0, description: "Reserved for disaster recovery", createdAt: "2024-03-01T00:00:00Z", updatedAt: "2024-03-01T00:00:00Z" },
  { id: "s6", blockId: "b2", cidr: "45.131.68.0/24", vlan: 200, gateway: "45.131.68.1", status: "Allocated", assignedTo: "EU Web Cluster", totalIPs: 256, usedIPs: 190, description: "EU web servers", createdAt: "2024-03-15T00:00:00Z", updatedAt: "2026-04-12T00:00:00Z" },
  { id: "s7", blockId: "b2", cidr: "45.131.69.0/24", vlan: 201, gateway: "45.131.69.1", status: "Allocated", assignedTo: "EU Database", totalIPs: 256, usedIPs: 120, description: "EU database tier", createdAt: "2024-03-15T00:00:00Z", updatedAt: "2026-03-20T00:00:00Z" },
  { id: "s8", blockId: "b2", cidr: "45.131.70.0/24", status: "Available", totalIPs: 256, usedIPs: 0, description: "Available", createdAt: "2024-03-15T00:00:00Z", updatedAt: "2024-03-15T00:00:00Z" },
  { id: "s9", blockId: "b2", cidr: "45.131.71.0/24", status: "Quarantine", totalIPs: 256, usedIPs: 0, description: "Quarantined - abuse report", createdAt: "2024-03-15T00:00:00Z", updatedAt: "2026-02-10T00:00:00Z" },
  { id: "s10", blockId: "b3", cidr: "198.51.100.0/25", vlan: 300, gateway: "198.51.100.1", status: "Allocated", assignedTo: "US CDN", totalIPs: 128, usedIPs: 110, description: "US West CDN", createdAt: "2024-06-05T00:00:00Z", updatedAt: "2026-03-10T00:00:00Z" },
  { id: "s11", blockId: "b3", cidr: "198.51.100.128/25", vlan: 301, gateway: "198.51.100.129", status: "Allocated", assignedTo: "Customer ACME", totalIPs: 128, usedIPs: 90, description: "ACME Corp dedicated", createdAt: "2024-07-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" },
];

export const MOCK_ALLOCATIONS: Allocation[] = [
  { id: "a1", subnetId: "s1", ipAddress: "103.152.220.10", assignee: "nginx-prod-01", purpose: "Server", status: "Active", assignedDate: "2024-02-01T00:00:00Z", expiryDate: "2027-02-01T00:00:00Z", notes: "Primary load balancer", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2026-04-20T00:00:00Z" },
  { id: "a2", subnetId: "s1", ipAddress: "103.152.220.11", assignee: "nginx-prod-02", purpose: "Server", status: "Active", assignedDate: "2024-02-01T00:00:00Z", expiryDate: "2027-02-01T00:00:00Z", notes: "Secondary load balancer", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2026-04-20T00:00:00Z" },
  { id: "a3", subnetId: "s1", ipAddress: "103.152.220.20", assignee: "api-gateway-01", purpose: "Server", status: "Active", assignedDate: "2024-03-15T00:00:00Z", notes: "API Gateway", createdAt: "2024-03-15T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z" },
  { id: "a4", subnetId: "s3", ipAddress: "103.152.222.10", assignee: "cdn-edge-tw01", purpose: "CDN", status: "Active", assignedDate: "2024-04-01T00:00:00Z", expiryDate: "2026-06-01T00:00:00Z", notes: "Taiwan CDN edge", createdAt: "2024-04-01T00:00:00Z", updatedAt: "2026-04-15T00:00:00Z" },
  { id: "a5", subnetId: "s3", ipAddress: "103.152.222.11", assignee: "cdn-edge-tw02", purpose: "CDN", status: "Active", assignedDate: "2024-04-01T00:00:00Z", expiryDate: "2026-06-01T00:00:00Z", createdAt: "2024-04-01T00:00:00Z", updatedAt: "2026-04-15T00:00:00Z" },
  { id: "a6", subnetId: "s2", ipAddress: "103.152.221.50", assignee: "dns-primary", purpose: "DNS", status: "Active", assignedDate: "2024-01-25T00:00:00Z", notes: "Primary authoritative DNS", createdAt: "2024-01-25T00:00:00Z", updatedAt: "2026-04-10T00:00:00Z" },
  { id: "a7", subnetId: "s2", ipAddress: "103.152.221.51", assignee: "dns-secondary", purpose: "DNS", status: "Active", assignedDate: "2024-01-25T00:00:00Z", createdAt: "2024-01-25T00:00:00Z", updatedAt: "2026-04-10T00:00:00Z" },
  { id: "a8", subnetId: "s11", ipAddress: "198.51.100.130", assignee: "ACME Corp", purpose: "Customer", status: "Active", assignedDate: "2024-07-01T00:00:00Z", expiryDate: "2026-07-01T00:00:00Z", notes: "Dedicated server", createdAt: "2024-07-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" },
  { id: "a9", subnetId: "s6", ipAddress: "45.131.68.100", assignee: "monitoring-eu", purpose: "Infrastructure", status: "Active", assignedDate: "2024-05-01T00:00:00Z", createdAt: "2024-05-01T00:00:00Z", updatedAt: "2026-03-20T00:00:00Z" },
  { id: "a10", subnetId: "s10", ipAddress: "198.51.100.50", assignee: "old-cdn-node", purpose: "CDN", status: "Expired", assignedDate: "2023-06-01T00:00:00Z", expiryDate: "2025-06-01T00:00:00Z", notes: "Decommissioned", createdAt: "2023-06-01T00:00:00Z", updatedAt: "2025-06-01T00:00:00Z" },
  { id: "a11", subnetId: "s1", ipAddress: "103.152.220.100", assignee: "new-app-server", purpose: "Server", status: "Pending", assignedDate: "2026-05-01T00:00:00Z", expiryDate: "2028-05-01T00:00:00Z", notes: "Pending provisioning", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z" },
];

export const MOCK_GEOFEED: GeofeedEntry[] = [
  { id: "g1", prefix: "103.152.220.0/24", countryCode: "TW", region: "TW-TPE", city: "Taipei", postalCode: "100", validation: "valid", lastUpdated: "2026-04-20T00:00:00Z" },
  { id: "g2", prefix: "103.152.221.0/24", countryCode: "TW", region: "TW-TPE", city: "Taipei", postalCode: "100", validation: "valid", lastUpdated: "2026-04-20T00:00:00Z" },
  { id: "g3", prefix: "103.152.222.0/24", countryCode: "TW", region: "TW-NWT", city: "New Taipei", postalCode: "220", validation: "valid", lastUpdated: "2026-04-18T00:00:00Z" },
  { id: "g4", prefix: "103.152.223.0/24", countryCode: "TW", region: "TW-TPE", city: "Taipei", validation: "valid", lastUpdated: "2026-04-15T00:00:00Z" },
  { id: "g5", prefix: "45.131.68.0/24", countryCode: "DE", region: "DE-HE", city: "Frankfurt", postalCode: "60306", validation: "valid", lastUpdated: "2026-04-12T00:00:00Z" },
  { id: "g6", prefix: "45.131.69.0/24", countryCode: "DE", region: "DE-HE", city: "Frankfurt", postalCode: "60306", validation: "valid", lastUpdated: "2026-04-12T00:00:00Z" },
  { id: "g7", prefix: "45.131.70.0/24", countryCode: "NL", region: "NL-NH", city: "Amsterdam", postalCode: "1012", validation: "valid", lastUpdated: "2026-03-10T00:00:00Z" },
  { id: "g8", prefix: "198.51.100.0/24", countryCode: "US", region: "US-CA", city: "Los Angeles", postalCode: "90001", validation: "valid", lastUpdated: "2026-03-15T00:00:00Z" },
  { id: "g9", prefix: "2001:db8::/32", countryCode: "TW", region: "TW-TPE", city: "Taipei", validation: "valid", lastUpdated: "2026-04-22T00:00:00Z" },
  { id: "g10", prefix: "2001:db8:1::/48", countryCode: "DE", region: "DE-HE", city: "Frankfurt", validation: "warning", validationMessage: "Region code may not be accurate", lastUpdated: "2026-04-10T00:00:00Z" },
];

export const MOCK_AUDIT_LOG: AuditEntry[] = [
  { id: "au1", timestamp: "2026-05-04T14:30:00Z", action: "Created", resourceType: "Allocation", resourceId: "a11", resourceLabel: "103.152.220.100", user: "admin", changes: [{ field: "status", before: "", after: "Pending" }] },
  { id: "au2", timestamp: "2026-05-04T10:15:00Z", action: "Updated", resourceType: "Geofeed", resourceId: "g10", resourceLabel: "2001:db8:1::/48", user: "admin", changes: [{ field: "city", before: "Berlin", after: "Frankfurt" }] },
  { id: "au3", timestamp: "2026-05-03T16:45:00Z", action: "Created", resourceType: "Subnet", resourceId: "s11", resourceLabel: "198.51.100.128/25", user: "admin" },
  { id: "au4", timestamp: "2026-05-02T09:00:00Z", action: "Updated", resourceType: "IPBlock", resourceId: "b5", resourceLabel: "192.0.2.0/24", user: "admin", changes: [{ field: "status", before: "Active", after: "Deprecated" }] },
  { id: "au5", timestamp: "2026-05-01T11:30:00Z", action: "Imported", resourceType: "Geofeed", resourceId: "batch", resourceLabel: "10 entries imported", user: "admin" },
  { id: "au6", timestamp: "2026-04-30T14:00:00Z", action: "Deleted", resourceType: "Allocation", resourceId: "old", resourceLabel: "192.0.2.50", user: "admin" },
  { id: "au7", timestamp: "2026-04-28T08:00:00Z", action: "Created", resourceType: "IPBlock", resourceId: "b8", resourceLabel: "2001:db8:2::/48", user: "admin" },
  { id: "au8", timestamp: "2026-04-25T15:20:00Z", action: "Updated", resourceType: "Subnet", resourceId: "s9", resourceLabel: "45.131.71.0/24", user: "admin", changes: [{ field: "status", before: "Available", after: "Quarantine" }] },
  { id: "au9", timestamp: "2026-04-22T10:00:00Z", action: "Exported", resourceType: "Geofeed", resourceId: "export", resourceLabel: "Full geofeed export", user: "admin" },
  { id: "au10", timestamp: "2026-04-20T09:30:00Z", action: "Updated", resourceType: "Allocation", resourceId: "a1", resourceLabel: "103.152.220.10", user: "admin", changes: [{ field: "expiryDate", before: "2026-02-01", after: "2027-02-01" }] },
];

export const MOCK_SETTINGS: AppSettings = {
  organizationName: "NetOps Inc.",
  asn: "AS13335",
  contactEmail: "noc@netops.example",
  defaultRIR: "APNIC",
  geofeedHeader: "NetOps Inc. Geofeed Data",
  geofeedAutoASN: true,
  defaultCountryCode: "TW",
  expiryWarningDays: 30,
  utilizationThreshold: 85,
};

// Dashboard chart data
export const ALLOCATION_TREND = [
  { month: "Jun", ipv4: 12, ipv6: 2 }, { month: "Jul", ipv4: 18, ipv6: 3 },
  { month: "Aug", ipv4: 15, ipv6: 4 }, { month: "Sep", ipv4: 22, ipv6: 5 },
  { month: "Oct", ipv4: 28, ipv6: 6 }, { month: "Nov", ipv4: 20, ipv6: 4 },
  { month: "Dec", ipv4: 35, ipv6: 8 }, { month: "Jan", ipv4: 30, ipv6: 7 },
  { month: "Feb", ipv4: 25, ipv6: 5 }, { month: "Mar", ipv4: 32, ipv6: 9 },
  { month: "Apr", ipv4: 28, ipv6: 6 }, { month: "May", ipv4: 15, ipv6: 3 },
];

export const RIR_DISTRIBUTION = [
  { name: "APNIC", value: 1536, color: "var(--chart-1)" },
  { name: "RIPE", value: 1024, color: "var(--chart-2)" },
  { name: "ARIN", value: 512, color: "var(--chart-3)" },
];
