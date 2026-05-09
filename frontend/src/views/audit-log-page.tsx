"use client";

import type {DataGridColumn} from "@heroui-pro/react";

import {Chip, Spinner} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useMemo} from "react";

import {AUDIT_ACTION_COLORS, type AuditAction} from "../data/types";
import {api} from "../lib/api";
import {useApiData} from "../lib/use-api";
import {useI18n} from "../i18n";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AuditLogPage() {
  const {t} = useI18n();
  const {data: logs, loading} = useApiData(() => api.audit.list(), []);

  const columns = useMemo<DataGridColumn<any>[]>(() => [
    { id: "timestamp", header: t.audit.timestamp, accessorKey: "timestamp", allowsSorting: true, minWidth: 140,
      cell: (item: any) => <span className="text-muted tabular-nums text-xs">{formatRelativeTime(item.timestamp ?? item.createdAt)}</span> },
    { id: "action", header: t.audit.action, accessorKey: "action", allowsSorting: true, minWidth: 100,
      cell: (item: any) => <Chip color={AUDIT_ACTION_COLORS[item.action as AuditAction] ?? "default"} size="sm" variant="soft">{item.action}</Chip> },
    { id: "resourceType", header: t.audit.resourceType, accessorKey: "resourceType", minWidth: 120,
      cell: (item: any) => <span className="text-xs font-medium">{item.resourceType}</span> },
    { id: "resourceLabel", header: t.audit.resource, accessorKey: "resourceLabel", isRowHeader: true, minWidth: 200,
      cell: (item: any) => <span className="font-mono text-xs font-medium">{item.resourceLabel}</span> },
    { id: "user", header: t.audit.user, accessorKey: "user", minWidth: 100,
      cell: (item: any) => <span className="text-muted text-xs">{item.user ?? "system"}</span> },
    { id: "details", header: t.audit.details, accessorKey: "details", minWidth: 300,
      cell: (item: any) => <span className="text-muted text-xs line-clamp-2">{item.details ?? "—"}</span> },
  ], [t]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">{t.audit.subtitle}</p>
      <DataGrid aria-label="Audit log" columns={columns} contentClassName="min-w-[800px]" data={logs ?? []} getRowId={(item: any) => item.id} />
    </div>
  );
}
