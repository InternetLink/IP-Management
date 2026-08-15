"use client";

import type {DataGridColumn} from "@heroui-pro/react";

import {Button, Chip, Label, ListBox, SearchField, Select, Spinner} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {RequestState} from "../components/request-state";
import {api} from "../lib/api";
import type {AuditAction, AuditEntry, AuditQueryParams, AuditResourceType} from "../lib/api-types";
import {useCursorPage} from "../lib/use-cursor-page";
import {useI18n} from "../i18n";

const AUDIT_ACTION_COLORS: Partial<Record<AuditAction, "success" | "accent" | "danger" | "warning" | "default">> = {
  Created: "success", Updated: "accent", Deleted: "danger", Imported: "warning", Exported: "default", Generated: "accent", Split: "accent",
};
const AUDIT_ACTIONS: readonly AuditAction[] = ["Created", "Updated", "Deleted", "Imported", "Exported", "Generated", "Split"];
const AUDIT_RESOURCE_TYPES: readonly AuditResourceType[] = ["Prefix", "Allocation", "Geofeed", "Settings", "User"];

function AuditFilter({label, onChange, options, value}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly string[];
  readonly value: string;
}) {
  return (
    <Select aria-label={label} className="w-full sm:w-44" selectedKey={value} onSelectionChange={(key) => key != null && onChange(String(key))}>
      <Label>{label}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => <ListBox.Item key={option} id={option}>{option}</ListBox.Item>)}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatChanges(changes: AuditEntry["changes"]): string {
  if (!changes || changes.length === 0) return "—";
  return changes.map((change) => {
    if ("field" in change) return `${change.field}: ${change.before} -> ${change.after}`;
    return `Cascade: ${change.descendantCount} descendants, ${change.allocationCount} allocations`;
  }).join("; ");
}

export function AuditLogPage() {
  const {t} = useI18n();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [resourceType, setResourceType] = useState<AuditResourceType | "all">("all");
  const auditQuery = useMemo<AuditQueryParams>(() => ({
    ...(action === "all" ? {} : {action}),
    ...(resourceType === "all" ? {} : {resourceType}),
    ...(search.trim() ? {search: search.trim()} : {}),
  }), [action, resourceType, search]);
  const {data: logs, error, loadMore, loadingMore, refetch, status} = useCursorPage(
    (query, signal) => api.audit.list(query, signal),
    auditQuery,
    100,
  );

  const columns = useMemo<DataGridColumn<AuditEntry>[]>(() => [
    { id: "timestamp", header: t.audit.timestamp, accessorKey: "timestamp", allowsSorting: true, minWidth: 140,
      cell: (item: AuditEntry) => <span className="text-muted tabular-nums text-xs">{formatRelativeTime(item.timestamp)}</span> },
    { id: "action", header: t.audit.action, accessorKey: "action", allowsSorting: true, minWidth: 100,
      cell: (item: AuditEntry) => <Chip color={AUDIT_ACTION_COLORS[item.action] ?? "default"} size="sm" variant="soft">{item.action}</Chip> },
    { id: "resourceType", header: t.audit.resourceType, accessorKey: "resourceType", minWidth: 120,
      cell: (item: AuditEntry) => <span className="text-xs font-medium">{item.resourceType}</span> },
    { id: "resourceLabel", header: t.audit.resource, accessorKey: "resourceLabel", isRowHeader: true, minWidth: 200,
      cell: (item: AuditEntry) => <span className="font-mono text-xs font-medium">{item.resourceLabel}</span> },
    { id: "user", header: t.audit.user, accessorKey: "user", minWidth: 100,
      cell: (item: AuditEntry) => <span className="text-muted text-xs">{item.user}</span> },
    { id: "details", header: t.audit.details, accessorKey: "changes", minWidth: 300,
      cell: (item: AuditEntry) => <span className="text-muted text-xs line-clamp-2">{formatChanges(item.changes)}</span> },
  ], [t]);

  if (!logs) {
    if (status === "error") {
      return (
        <div className="mx-auto max-w-7xl px-5 py-10">
          <RequestState error={error} errorTitle="Unable to load audit log" onRetryAction={refetch} status={status} />
        </div>
      );
    }
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">{t.audit.subtitle}</p>
      <RequestState error={error} errorTitle="Unable to refresh audit log" onRetryAction={refetch} status={status} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <SearchField aria-label={t.audit.searchLabel} className="w-full sm:w-64" name="audit-search" value={search} variant="secondary" onChange={setSearch}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={`${t.common.search}...`} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <AuditFilter
          label={t.audit.action}
          options={[t.audit.allActions, ...AUDIT_ACTIONS]}
          value={action === "all" ? t.audit.allActions : action}
          onChange={(value) => setAction(value === t.audit.allActions ? "all" : value as AuditAction)}
        />
        <AuditFilter
          label={t.audit.resourceType}
          options={[t.audit.allResources, ...AUDIT_RESOURCE_TYPES]}
          value={resourceType === "all" ? t.audit.allResources : resourceType}
          onChange={(value) => setResourceType(value === t.audit.allResources ? "all" : value as AuditResourceType)}
        />
      </div>
      <DataGrid aria-label="Audit log" columns={columns} contentClassName="min-w-[800px]" data={logs.items} getRowId={(item: AuditEntry) => item.id} />
      {logs.nextCursor && (
        <div className="flex justify-center">
          <Button isDisabled={loadingMore} size="sm" variant="secondary" onPress={loadMore}>
            {loadingMore ? t.common.loading : t.common.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
