import type { GeofeedEntry } from "../data/types";
import { getCountryByCode } from "./geo";
import { parseCidr } from "./cidr";

export interface GeofeedOptions {
  header?: string;
  includeASN?: boolean;
  asn?: string;
  includeTimestamp?: boolean;
}

export function generateGeofeed(entries: GeofeedEntry[], options: GeofeedOptions = {}): string {
  const lines: string[] = [];
  if (options.header) {
    for (const line of options.header.split("\n")) lines.push(`# ${line.trim()}`);
  }
  if (options.includeASN && options.asn) lines.push(`# Geofeed for ${options.asn}`);
  if (options.includeTimestamp) lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push("# Format: ip_prefix,country_code,region_code,city,postal_code");
  lines.push("");

  const sorted = [...entries].sort((a, b) => a.prefix.localeCompare(b.prefix));
  for (const entry of sorted) {
    const parts = [entry.prefix, entry.countryCode, entry.region || "", entry.city || "", entry.postalCode || ""];
    while (parts.length > 2 && parts[parts.length - 1] === "") parts.pop();
    lines.push(parts.join(","));
  }
  return lines.join("\n") + "\n";
}

export interface ParseResult {
  entries: GeofeedEntry[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

export function parseGeofeedCSV(csv: string): ParseResult {
  const lines = csv.split("\n");
  const entries: GeofeedEntry[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) { errors.push({ line: i + 1, message: "Need prefix + country" }); continue; }
    const prefix = parts[0];
    const countryCode = parts[1].toUpperCase();
    const parsed = parseCidr(prefix);
    if (!parsed) { errors.push({ line: i + 1, message: `Invalid CIDR: ${prefix}` }); continue; }
    if (!getCountryByCode(countryCode)) warnings.push({ line: i + 1, message: `Unknown country: ${countryCode}` });
    const hasError = errors.some((e) => e.line === i + 1);
    const hasWarn = warnings.some((w) => w.line === i + 1);
    entries.push({
      id: `import-${i}`, prefix, countryCode, region: parts[2], city: parts[3], postalCode: parts[4],
      validation: hasError ? "error" : hasWarn ? "warning" : "valid",
      validationMessage: hasError || hasWarn ? [...errors, ...warnings].find((e) => e.line === i + 1)?.message : undefined,
      lastUpdated: new Date().toISOString(),
    });
  }
  return { entries, errors, warnings };
}

export function validateGeofeedEntry(entry: Partial<GeofeedEntry>): { valid: boolean; errors: string[]; warnings: string[] } {
  const errs: string[] = [];
  const warns: string[] = [];
  if (!entry.prefix) errs.push("Prefix is required");
  else if (!parseCidr(entry.prefix)) errs.push("Invalid CIDR format");
  if (!entry.countryCode) errs.push("Country code is required");
  else if (!getCountryByCode(entry.countryCode)) warns.push(`Unknown country: ${entry.countryCode}`);
  return { valid: errs.length === 0, errors: errs, warnings: warns };
}
