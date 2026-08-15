import type {GeofeedImportError, GeofeedImportResponse} from "./api-types";

export function formatSplitToastDescription(created: number, childrenCreatedLabel: string): string {
  return `${created} ${childrenCreatedLabel}`;
}

export function formatGeofeedImportSummary(result: Pick<GeofeedImportResponse, "imported" | "failed">): string {
  return `${result.imported} entries imported, ${result.failed} failed`;
}

export function formatGeofeedImportErrors(errors: readonly GeofeedImportError[]): string {
  if (errors.length === 0) return "The server reported failed rows without error details.";
  const visible = errors.slice(0, 5).map((error) => `Line ${error.line}: ${error.message}`);
  const remaining = errors.length - visible.length;
  return `${visible.join("; ")}${remaining > 0 ? `; ${remaining} more errors` : ""}`;
}
