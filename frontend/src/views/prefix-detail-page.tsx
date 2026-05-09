"use client";

import {ArrowLeft, Plus, ArrowsRotateRight, Pencil, LayoutSplitColumns, ChevronRight, CircleCheck, CircleDashed, CircleExclamation, LayoutList, TrashBin, ArrowDown, ArrowUp, ArrowUpArrowDown} from "@gravity-ui/icons";
import {Button, Card, Chip, Input, Label, ListBox, Select, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid, type DataGridColumn} from "@heroui-pro/react";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {Selection} from "react-aria-components";

import {IconButton} from "../components/icon-button";
import {SimpleModal} from "../components/simple-modal";
import {api} from "../lib/api";
import {ipv4ToNumber, ipv6ToBigInt, isSubsetOf, isValidIPv4, isValidIPv6, parseCidr, validateCidr} from "../lib/cidr";
import {useI18n} from "../i18n";

const STATUS_COLORS: Record<string, "success" | "warning" | "accent" | "danger" | "default"> = {
  Active: "success", Allocated: "success", Available: "accent", Reserved: "warning", Deprecated: "danger",
};
const STATUS_ICONS: Record<string, any> = {
  Available: CircleDashed, Allocated: CircleCheck, Reserved: CircleExclamation,
};
const ALLOCATION_STATUS_OPTIONS = ["Available", "Allocated", "Reserved"] as const;
const ALLOCATION_PURPOSE_OPTIONS = ["Server", "CDN", "DNS", "Customer", "Infrastructure"] as const;
const KEEP_VALUE = "__keep__";
const OPTION_LABELS: Record<string, string> = {
  [KEEP_VALUE]: "Keep current",
};

function UtilBar({total, used, className}: {total: number; used: number; className?: string}) {
  if (total <= 0) return <Chip size="sm" variant="soft" color="accent">IPv6</Chip>;
  const pct = Math.min((used / total) * 100, 100);
  const color = pct > 85 ? "hsl(0 72% 51%)" : pct > 50 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <div className="bg-default-200 h-1.5 w-20 overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all duration-500" style={{width: `${pct}%`, backgroundColor: color}} />
      </div>
      <span className="text-muted tabular-nums text-xs font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}

// ── IP numeric sort: multiply instead of bitwise shift to avoid overflow on high octets ──
function ipToNum(ip: string): number {
  if (ip.includes(':')) return 0; // IPv6 — keep original order
  const p = ip.split('.').map(Number);
  return p[0] * 16777216 + p[1] * 65536 + p[2] * 256 + p[3];
}

function statusColor(status: string) {
  if (status === "Allocated" || status === "Active") return "var(--success)";
  if (status === "Reserved") return "var(--warning)";
  if (status === "Deprecated") return "var(--danger)";
  if (status === "Available") return "var(--accent)";
  return "var(--default)";
}

function cidrRange(cidr: string) {
  const parsed = parseCidr(cidr);
  if (!parsed) return null;

  const bits = parsed.version === 4 ? 32 : 128;
  const ip = parsed.version === 4 ? BigInt(ipv4ToNumber(parsed.ip)) : ipv6ToBigInt(parsed.ip);
  const size = 1n << BigInt(bits - parsed.prefix);
  const start = (ip / size) * size;
  return {end: start + size - 1n, size, start, version: parsed.version};
}

function percent(part: bigint, total: bigint) {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function validatePrefixMetadata(data: {cidr: string; vlan: string; gateway: string}, parentCidr: string) {
  const cidr = validateCidr(data.cidr);
  if (!cidr.valid) return cidr.error ?? "Invalid CIDR";

  const child = parseCidr(data.cidr);
  const parent = parseCidr(parentCidr);
  if (!child || !parent || child.version !== parent.version) return "Child prefix must use the same IP version as the parent";
  if (child.prefix <= parent.prefix) return "Child prefix length must be greater than the parent prefix length";
  if (!isSubsetOf(data.cidr, parentCidr)) return "Child prefix must be contained by the parent prefix";

  if (data.vlan) {
    const vlan = Number(data.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return "VLAN must be an integer between 1 and 4094";
  }

  if (data.gateway && !isValidIPv4(data.gateway) && !isValidIPv6(data.gateway)) {
    return "Gateway must be a valid IPv4 or IPv6 address";
  }

  return null;
}

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  const input = toDateInputValue(value);
  return input || "—";
}

function OptionSelect({
  labels,
  label,
  onChange,
  options,
  value,
}: {
  labels?: Record<string, string>;
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <Select fullWidth selectedKey={value} onSelectionChange={(key) => key != null && onChange(String(key))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option} id={option} textValue={labels?.[option] ?? option}>
              <ListBox.ItemIndicator />
              {labels?.[option] ?? option}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function PrefixSpaceVisualization({
  childPrefixes,
  onOpenPrefix,
  prefix,
}: {
  childPrefixes: any[];
  onOpenPrefix: (id: string) => void;
  prefix: any;
}) {
  const parentRange = cidrRange(prefix.cidr);
  const segments = useMemo(() => {
    if (!parentRange) return [];
    return childPrefixes
      .map((child) => {
        const range = cidrRange(child.cidr);
        if (!range || range.version !== parentRange.version) return null;
        const left = percent(range.start - parentRange.start, parentRange.size);
        const width = percent(range.size, parentRange.size);
        return {...child, left, width: Math.max(width, 0.6)};
      })
      .filter(Boolean) as Array<any & {left: number; width: number}>;
  }, [childPrefixes, parentRange]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-sm font-semibold">Address Space</p>
          <p className="text-muted text-xs">Child prefix occupancy inside this prefix.</p>
        </div>
        <span className="text-muted text-xs tabular-nums">{childPrefixes.length} child prefixes</span>
      </div>
      <div className="bg-default-100 relative h-10 overflow-hidden rounded-xl">
        {segments.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-xs">No child prefixes yet</div>
        ) : (
          segments.map((segment) => (
            <button
              key={segment.id}
              className="absolute top-0 h-full min-w-1 border-r border-background/70 transition-opacity hover:opacity-80"
              title={`${segment.cidr} · ${segment.status}`}
              style={{
                backgroundColor: statusColor(segment.status),
                left: `${segment.left}%`,
                width: `${segment.width}%`,
              }}
              onClick={() => onOpenPrefix(segment.id)}
            />
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {segments.slice(0, 8).map((segment) => (
          <span key={segment.id} className="text-muted flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full" style={{backgroundColor: statusColor(segment.status)}} />
            <span className="font-mono">{segment.cidr}</span>
          </span>
        ))}
        {segments.length > 8 && <span className="text-muted text-xs">+{segments.length - 8} more</span>}
      </div>
    </div>
  );
}

function AllocationPoolVisualization({allocations, counts}: {allocations: any[]; counts: {all: number; Available: number; Allocated: number; Reserved: number}}) {
  const sorted = useMemo(() => [...allocations].sort((a, b) => ipToNum(a.ipAddress) - ipToNum(b.ipAddress)), [allocations]);
  const statusSegments = [
    {count: counts.Available, label: "Available", color: statusColor("Available")},
    {count: counts.Allocated, label: "Allocated", color: statusColor("Allocated")},
    {count: counts.Reserved, label: "Reserved", color: statusColor("Reserved")},
  ].filter((segment) => segment.count > 0);

  if (counts.all === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-sm font-semibold">IP Pool</p>
          <p className="text-muted text-xs">Allocation status distribution and address order.</p>
        </div>
        <span className="text-muted text-xs tabular-nums">{counts.all} IPs</span>
      </div>
      <div className="bg-default-100 flex h-3 overflow-hidden rounded-full">
        {statusSegments.map((segment) => (
          <div
            key={segment.label}
            title={`${segment.label}: ${segment.count}`}
            style={{backgroundColor: segment.color, width: `${(segment.count / counts.all) * 100}%`}}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {statusSegments.map((segment) => (
          <div key={segment.label} className="rounded-lg bg-default-100 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{backgroundColor: segment.color}} />
              <span className="text-muted text-xs">{segment.label}</span>
            </div>
            <p className="text-foreground mt-1 text-sm font-semibold tabular-nums">{segment.count}</p>
          </div>
        ))}
      </div>
      <div className="grid max-h-24 grid-cols-[repeat(auto-fill,minmax(7px,1fr))] gap-1 overflow-hidden rounded-lg bg-default-100 p-2">
        {sorted.map((allocation) => (
          <span
            key={allocation.id}
            className="aspect-square rounded-[2px]"
            title={`${allocation.ipAddress} · ${allocation.status}`}
            style={{backgroundColor: statusColor(allocation.status)}}
          />
        ))}
      </div>
    </div>
  );
}

function PrefixVisualizationCard({
  allocations,
  childPrefixes,
  counts,
  onOpenPrefix,
  prefix,
}: {
  allocations: any[];
  childPrefixes: any[];
  counts: {all: number; Available: number; Allocated: number; Reserved: number};
  onOpenPrefix: (id: string) => void;
  prefix: any;
}) {
  return (
    <Card className="rounded-2xl p-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <PrefixSpaceVisualization childPrefixes={childPrefixes} onOpenPrefix={onOpenPrefix} prefix={prefix} />
        <AllocationPoolVisualization allocations={allocations} counts={counts} />
      </div>
    </Card>
  );
}

type SortDir = 'asc' | 'desc';
type SortState = { col: string; dir: SortDir } | null;

export function PrefixDetailPage({prefixId}: {prefixId: string}) {
  const {t} = useI18n();
  const router = useRouter();
  const [prefix, setPrefix] = useState<any>(null);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [allAllocations, setAllAllocations] = useState<any[]>([]);
  const [allCounts, setAllCounts] = useState({all: 0, Available: 0, Allocated: 0, Reserved: 0});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState>({col: 'ipAddress', dir: 'asc'});
  const [selectedAllocationKeys, setSelectedAllocationKeys] = useState<Selection>(new Set());

  const toggleSort = useCallback((col: string) => {
    setSort(prev => {
      if (prev?.col === col) return prev.dir === 'asc' ? {col, dir: 'desc'} : null;
      return {col, dir: 'asc'};
    });
  }, []);

  const sortedAllocations = useMemo(() => {
    if (!sort) return allocations;
    const sorted = [...allocations].sort((a, b) => {
      if (sort.col === 'ipAddress') {
        return ipToNum(a.ipAddress) - ipToNum(b.ipAddress);
      }
      const va = (a[sort.col] ?? '') as string;
      const vb = (b[sort.col] ?? '') as string;
      return va.localeCompare(vb);
    });
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [allocations, sort]);

  // Modals
  const [showSplit, setShowSplit] = useState(false);
  const [splitLen, setSplitLen] = useState("");
  const [showAddChild, setShowAddChild] = useState(false);
  const [childForm, setChildForm] = useState({cidr: "", vlan: "", gateway: "", assignedTo: "", description: ""});
  const [editAlloc, setEditAlloc] = useState<any>(null);
  const [showEditAlloc, setShowEditAlloc] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({assignee: "", expiryDate: "", purpose: KEEP_VALUE, status: KEEP_VALUE});
  const currentPrefixLen = prefix ? parseInt(prefix.cidr.split('/')[1], 10) : 0;
  const maxPrefixLength = prefix?.version === 6 ? 128 : 32;

  const loadData = useCallback(async () => {
    try {
      const p = await api.prefixes.get(prefixId);
      setPrefix(p);
      if (p.isPool || p._count?.allocations > 0) {
        const [filtered, all] = await Promise.all([
          api.prefixes.allocations(prefixId, filter),
          api.prefixes.allocations(prefixId),
        ]);
        setAllocations(filtered);
        setAllAllocations(all);
        setAllCounts({
          all: all.length,
          Available: all.filter((a: any) => a.status === "Available").length,
          Allocated: all.filter((a: any) => a.status === "Allocated").length,
          Reserved: all.filter((a: any) => a.status === "Reserved").length,
        });
      } else {
        setAllocations([]);
        setAllAllocations([]);
        setAllCounts({all: 0, Available: 0, Allocated: 0, Reserved: 0});
      }
    } catch (err: any) { toast.danger(err.message); }
    finally { setLoading(false); }
  }, [prefixId, filter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenPrefix = useCallback((id: string) => {
    router.push(`/prefixes/${id}`);
  }, [router]);

  // ── Actions ──
  const handleGenerateIPs = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await api.prefixes.generateIPs(prefixId);
      toast.success(t.prefixes.generateIPs, {description: `${result.generated} IPs`});
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setGenerating(false); }
  }, [prefixId, loadData, t]);

  const handleSplit = useCallback(async () => {
    if (!prefix) return;

    const targetPrefixLength = Number(splitLen);
    if (!Number.isInteger(targetPrefixLength) || targetPrefixLength <= currentPrefixLen || targetPrefixLength > maxPrefixLength) {
      toast.danger(`New prefix length must be between ${currentPrefixLen + 1} and ${maxPrefixLength}`);
      return;
    }

    setSaving(true);
    try {
      const result = await api.prefixes.split(prefixId, targetPrefixLength);
      toast.success(t.prefixes.split, {description: `${result.created.length} ${t.prefixes.childrenCreated}`});
      setShowSplit(false);
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [currentPrefixLen, maxPrefixLength, prefix, prefixId, splitLen, loadData, t]);

  const handleAddChild = useCallback(async () => {
    if (!prefix) return;

    const validationError = validatePrefixMetadata(childForm, prefix.cidr);
    if (validationError) {
      toast.danger(validationError);
      return;
    }

    setSaving(true);
    try {
      await api.prefixes.create({
        cidr: childForm.cidr, version: childForm.cidr.includes(':') ? 6 : 4,
        parentId: prefixId, status: "Available",
        vlan: childForm.vlan ? Number(childForm.vlan) : undefined,
        gateway: childForm.gateway || undefined,
        assignedTo: childForm.assignedTo || undefined,
        description: childForm.description || undefined,
      });
      toast.success(t.common.create);
      setShowAddChild(false);
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [prefixId, childForm, prefix, loadData, t]);

  const handleSaveAlloc = useCallback(async () => {
    setSaving(true);
    try {
      await api.prefixes.updateAllocation(prefixId, editAlloc.id, {
        status: editAlloc.status, assignee: editAlloc.assignee,
        purpose: editAlloc.purpose, notes: editAlloc.notes,
        expiryDate: editAlloc.expiryDate ? new Date(`${editAlloc.expiryDate}T00:00:00.000Z`).toISOString() : null,
      });
      toast.success(t.common.save);
      setShowEditAlloc(false);
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [editAlloc, prefixId, loadData, t]);

  const selectedAllocationIds = useMemo(() => {
    if (selectedAllocationKeys === "all") return sortedAllocations.map((allocation) => allocation.id);
    return Array.from(selectedAllocationKeys).map(String);
  }, [selectedAllocationKeys, sortedAllocations]);

  const handleOpenBulkEdit = useCallback(() => {
    if (selectedAllocationIds.length === 0) {
      toast.danger("Select at least one IP address first");
      return;
    }
    setBulkForm({assignee: "", expiryDate: "", purpose: KEEP_VALUE, status: KEEP_VALUE});
    setShowBulkEdit(true);
  }, [selectedAllocationIds.length]);

  const handleBulkUpdate = useCallback(async () => {
    const payload: any = {allocationIds: selectedAllocationIds};
    if (bulkForm.status !== KEEP_VALUE) payload.status = bulkForm.status;
    if (bulkForm.purpose !== KEEP_VALUE) payload.purpose = bulkForm.purpose;
    if (bulkForm.assignee.trim()) payload.assignee = bulkForm.assignee.trim();
    if (bulkForm.expiryDate) payload.expiryDate = new Date(`${bulkForm.expiryDate}T00:00:00.000Z`).toISOString();

    if (Object.keys(payload).length === 1) {
      toast.danger("Choose at least one field to update");
      return;
    }

    setSaving(true);
    try {
      const result = await api.prefixes.bulkUpdateAllocations(prefixId, payload);
      toast.success("Bulk update complete", {description: `${result.updated} IPs updated`});
      setSelectedAllocationKeys(new Set());
      setShowBulkEdit(false);
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [bulkForm, loadData, prefixId, selectedAllocationIds]);

  const handleBulkStatusUpdate = useCallback(async (status: string) => {
    if (selectedAllocationIds.length === 0) {
      toast.danger("Select at least one IP address first");
      return;
    }

    setSaving(true);
    try {
      const result = await api.prefixes.bulkUpdateAllocations(prefixId, {allocationIds: selectedAllocationIds, status});
      toast.success("Bulk update complete", {description: `${result.updated} IPs marked ${status}`});
      setSelectedAllocationKeys(new Set());
      loadData();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [loadData, prefixId, selectedAllocationIds]);

  const handleDeleteChild = useCallback(async (child: any) => {
    const childCount = child._count?.children ?? 0;
    const allocationCount = child._count?.allocations ?? 0;
    if (!confirm(`${t.prefixes.deleteWarning} ${child.cidr}\nChildren: ${childCount}; Allocations: ${allocationCount}. Cascade delete cannot be undone.`)) return;
    try {
      await api.prefixes.delete(child.id);
      toast.success(t.common.delete);
      loadData();
    } catch (err: any) { toast.danger(err.message); }
  }, [loadData, t]);

  // ── Sortable column header ──
  const SortHeader = useCallback(({col, label}: {col: string; label: string}) => {
    const active = sort?.col === col;
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpArrowDown;
    return (
      <button className={`flex items-center gap-1 text-left transition-colors ${active ? 'text-foreground' : 'text-muted hover:text-foreground'}`} onClick={() => toggleSort(col)}>
        {label}<Icon className={`size-3 ${active ? 'text-accent' : 'text-muted'}`} />
      </button>
    );
  }, [sort, toggleSort]);

  // ── Columns for IP table ──
  const ipColumns = useMemo<DataGridColumn<any>[]>(() => [
    { id: "ipAddress", header: () => <SortHeader col="ipAddress" label={t.prefixes.ipAddress} />, accessorKey: "ipAddress", minWidth: 200, isRowHeader: true,
      cell: (item: any) => <span className="text-foreground font-mono text-sm font-semibold tracking-tight">{item.ipAddress}</span> },
    { id: "status", header: () => <SortHeader col="status" label={t.common.status} />, accessorKey: "status", minWidth: 130,
      cell: (item: any) => { const Icon = STATUS_ICONS[item.status] ?? CircleDashed; return <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] ?? "default"}><Icon className="size-3" />{item.status}</Chip>; } },
    { id: "assignee", header: () => <SortHeader col="assignee" label={t.prefixes.assignee} />, accessorKey: "assignee", minWidth: 180,
      cell: (item: any) => item.assignee ? <span className="text-foreground text-sm">{item.assignee}</span> : <span className="text-muted text-xs">—</span> },
    { id: "purpose", header: () => <SortHeader col="purpose" label={t.prefixes.purpose} />, accessorKey: "purpose", minWidth: 130,
      cell: (item: any) => <Chip size="sm" variant="tertiary" color="default">{item.purpose}</Chip> },
    { id: "expiryDate", header: () => <SortHeader col="expiryDate" label="Expiry" />, accessorKey: "expiryDate", minWidth: 120,
      cell: (item: any) => <span className="text-muted text-xs tabular-nums">{formatDate(item.expiryDate)}</span> },
    { id: "notes", header: t.prefixes.notes, accessorKey: "notes", minWidth: 180,
      cell: (item: any) => <span className="text-muted text-xs line-clamp-1">{item.notes || ""}</span> },
    { id: "actions", header: "", minWidth: 80,
      cell: (item: any) => <Button size="sm" variant="ghost" onPress={() => { setEditAlloc({...item, expiryDate: toDateInputValue(item.expiryDate)}); setShowEditAlloc(true); }}><Pencil className="size-3.5" />{t.common.edit}</Button> },
  ], [t, SortHeader]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!prefix) return <div className="flex justify-center py-20"><p className="text-muted">Not found</p></div>;

  const children = prefix.children ?? [];
  const hasChildren = children.length > 0;
  const hasIPs = allCounts.all > 0 || prefix.isPool;
  const filterTabs = [
    {key: "all", label: t.prefixes.filterAll, count: allCounts.all},
    {key: "Available", label: t.prefixes.filterAvailable, count: allCounts.Available},
    {key: "Allocated", label: t.prefixes.filterAllocated, count: allCounts.Allocated},
    {key: "Reserved", label: t.prefixes.filterReserved, count: allCounts.Reserved},
  ];
  const utilPct = prefix.totalIPs > 0 ? Math.min((prefix.usedIPs / prefix.totalIPs) * 100, 100) : 0;
  const utilColor = utilPct > 85 ? "hsl(0 72% 51%)" : utilPct > 50 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 pb-10 pt-4">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-accent/5 via-transparent to-accent/3 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button className="text-muted hover:text-foreground hover:bg-default-100 flex size-9 items-center justify-center rounded-lg transition-colors" onClick={() => {
              if (prefix.parent) router.push(`/prefixes/${prefix.parent.id}`);
              else router.push("/prefixes");
            }}>
              <ArrowLeft className="size-5" />
            </button>
            <div>
              {prefix.parent && <p className="text-muted font-mono text-xs">{prefix.parent.cidr} →</p>}
              <h1 className="text-foreground font-mono text-xl font-bold tracking-tight">{prefix.cidr}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onPress={() => { setSplitLen(String(currentPrefixLen + 1)); setShowSplit(true); }}>
              <LayoutSplitColumns className="size-4" />{t.prefixes.split}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => { setChildForm({cidr: "", vlan: "", gateway: "", assignedTo: "", description: ""}); setShowAddChild(true); }}>
              <Plus className="size-4" />{t.prefixes.addChild}
            </Button>
            {prefix.version === 4 && (
              <Button size="sm" isDisabled={generating} onPress={handleGenerateIPs}>
                <Plus className="size-4" />{t.prefixes.generateIPs}
              </Button>
            )}
            <button className="text-muted hover:text-foreground hover:bg-default-100 flex size-9 items-center justify-center rounded-lg transition-colors" onClick={loadData}>
              <ArrowsRotateRight className="size-4" />
            </button>
          </div>
        </div>
        {/* Metadata row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Chip size="sm" variant="soft" color={STATUS_COLORS[prefix.status] ?? "default"}>{prefix.status}</Chip>
          {prefix.rir && <Chip size="sm" variant="tertiary" color="default">{prefix.rir}</Chip>}
          {prefix.vlan != null && <Chip size="sm" variant="tertiary" color="default">VLAN {prefix.vlan}</Chip>}
          {prefix.gateway && <span className="text-muted text-xs">GW <span className="text-foreground font-mono">{prefix.gateway}</span></span>}
          {prefix.assignedTo && <span className="text-muted text-xs">→ <span className="text-foreground font-medium">{prefix.assignedTo}</span></span>}
          {prefix.description && <span className="text-muted text-xs">{prefix.description}</span>}
          {prefix.totalIPs > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <div className="bg-default-200 h-1.5 w-28 overflow-hidden rounded-full">
                <div className="h-full rounded-full transition-all" style={{width: `${utilPct}%`, backgroundColor: utilColor}} />
              </div>
              <span className="text-foreground tabular-nums text-xs font-medium">{utilPct.toFixed(0)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Children Prefixes ── */}
      <PrefixVisualizationCard allocations={allAllocations} childPrefixes={children} counts={allCounts} onOpenPrefix={handleOpenPrefix} prefix={prefix} />

      {/* ── Children Prefixes ── */}
      {hasChildren && (
        <Card className="overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b bg-default-50/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-foreground text-sm font-semibold">{t.prefixes.childPrefixes}</span>
              <span className="bg-default-200 text-muted rounded-md px-2 py-0.5 text-xs font-medium tabular-nums">{children.length}</span>
            </div>
          </div>
          <div className="py-1">
            {children.map((child: any) => (
              <div key={child.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-default-50">
                <button className="text-foreground font-mono text-sm font-semibold tracking-tight hover:text-accent transition-colors" onClick={() => router.push(`/prefixes/${child.id}`)}>
                  {child.cidr}
                </button>
                <span className="bg-default-300 size-1 rounded-full" />
                <Chip size="sm" variant="soft" color={STATUS_COLORS[child.status] ?? "default"}>{child.status}</Chip>
                {child.vlan != null && <span className="text-muted text-xs">VLAN {child.vlan}</span>}
                {child.assignedTo && <span className="text-muted text-xs font-medium truncate">{child.assignedTo}</span>}
                <div className="flex-1" />
                <UtilBar total={child.totalIPs} used={child.usedIPs} />
                {(child._count?.children ?? 0) > 0 && <Chip size="sm" variant="tertiary" color="default">{child._count.children} sub</Chip>}
                {(child._count?.allocations ?? 0) > 0 && <Chip size="sm" variant="soft" color="accent">{child._count.allocations} IPs</Chip>}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton label="Open" size="sm" variant="tertiary" onPress={() => router.push(`/prefixes/${child.id}`)}><ChevronRight className="size-3.5" /></IconButton>
                  <IconButton label="Delete" size="sm" variant="danger-soft" onPress={() => handleDeleteChild(child)}><TrashBin className="size-3.5" /></IconButton>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── IP Allocations (Pool) ── */}
      {hasIPs && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 rounded-xl bg-default-100 p-1">
              {filterTabs.map(tab => (
                <button key={tab.key} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${filter === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`} onClick={() => { setFilter(tab.key); setSelectedAllocationKeys(new Set()); }}>
                  {tab.label}<span className={`tabular-nums text-xs ${filter === tab.key ? "text-accent" : "text-muted"}`}>{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs tabular-nums">{selectedAllocationIds.length} selected</span>
              {ALLOCATION_STATUS_OPTIONS.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant="ghost"
                  isDisabled={saving || selectedAllocationIds.length === 0}
                  onPress={() => handleBulkStatusUpdate(status)}
                >
                  Mark {status}
                </Button>
              ))}
              <Button size="sm" variant="secondary" isDisabled={selectedAllocationIds.length === 0} onPress={handleOpenBulkEdit}>
                Bulk edit
              </Button>
              {selectedAllocationIds.length > 0 && (
                <Button size="sm" variant="ghost" onPress={() => setSelectedAllocationKeys(new Set())}>Clear</Button>
              )}
            </div>
          </div>
          <DataGrid
            aria-label="IP Allocations"
            columns={ipColumns}
            contentClassName="min-w-[760px]"
            data={sortedAllocations}
            getRowId={(item: any) => item.id}
            selectedKeys={selectedAllocationKeys}
            selectionMode="multiple"
            showSelectionCheckboxes
            onSelectionChange={setSelectedAllocationKeys}
          />
        </>
      )}

      {/* Empty state when no children and no IPs */}
      {!hasChildren && !hasIPs && (
        <Card className="flex flex-col items-center gap-4 py-16">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-default-100">
            <LayoutList className="text-muted size-8" />
          </div>
          <p className="text-foreground text-sm font-medium">{t.prefixes.emptyPrefixState}</p>
          <p className="text-muted text-xs">{t.prefixes.emptyPrefixHint}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onPress={() => { setSplitLen(String(currentPrefixLen + 1)); setShowSplit(true); }}>
              <LayoutSplitColumns className="size-4" />{t.prefixes.split}
            </Button>
            {prefix.version === 4 && (
              <Button size="sm" isDisabled={generating} onPress={handleGenerateIPs}>
                <Plus className="size-4" />{t.prefixes.generateIPs}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ── Split Modal ── */}
      <SimpleModal isOpen={showSplit} onClose={() => setShowSplit(false)} title={`${t.prefixes.split}: ${prefix.cidr}`} footer={<>
        <Button variant="ghost" onPress={() => setShowSplit(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleSplit}>{t.prefixes.split}</Button>
      </>}>
        <p className="text-muted text-sm">{t.prefixes.splitDesc}</p>
        <TextField value={splitLen} onChange={setSplitLen}>
          <Label>{t.prefixes.newPrefixLength}</Label><Input type="number" placeholder={String(currentPrefixLen + 1)} />
        </TextField>
      </SimpleModal>

      {/* ── Add Child Modal ── */}
      <SimpleModal isOpen={showAddChild} onClose={() => setShowAddChild(false)} title={`${t.prefixes.addChild}: ${prefix.cidr}`} footer={<>
        <Button variant="ghost" onPress={() => setShowAddChild(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleAddChild}>{t.common.create}</Button>
      </>}>
        <TextField value={childForm.cidr} onChange={(v) => setChildForm(p => ({...p, cidr: v}))}><Label>CIDR</Label><Input placeholder={`${prefix.cidr.split('/')[0]}/${currentPrefixLen + 1}`} className="font-mono" /></TextField>
        <TextField value={childForm.vlan} onChange={(v) => setChildForm(p => ({...p, vlan: v}))}><Label>VLAN</Label><Input type="number" /></TextField>
        <TextField value={childForm.gateway} onChange={(v) => setChildForm(p => ({...p, gateway: v}))}><Label>Gateway</Label><Input className="font-mono" /></TextField>
        <TextField value={childForm.assignedTo} onChange={(v) => setChildForm(p => ({...p, assignedTo: v}))}><Label>{t.prefixes.assignedTo}</Label><Input /></TextField>
        <TextField value={childForm.description} onChange={(v) => setChildForm(p => ({...p, description: v}))}><Label>{t.common.description}</Label><Input /></TextField>
      </SimpleModal>

      {/* ── Edit Allocation Modal ── */}
      {editAlloc && (
        <SimpleModal isOpen={showEditAlloc} onClose={() => setShowEditAlloc(false)} title={editAlloc.ipAddress} footer={<>
          <Button variant="ghost" onPress={() => setShowEditAlloc(false)}>{t.common.cancel}</Button>
          <Button isDisabled={saving} onPress={handleSaveAlloc}>{t.common.save}</Button>
        </>}>
          <OptionSelect
            label={t.common.status}
            options={ALLOCATION_STATUS_OPTIONS}
            value={editAlloc.status ?? "Available"}
            onChange={(v) => setEditAlloc((p: any) => ({...p, status: v}))}
          />
          <TextField value={editAlloc.assignee ?? ""} onChange={(v) => setEditAlloc((p: any) => ({...p, assignee: v}))}><Label>{t.prefixes.assignee}</Label><Input placeholder="nginx-prod-01" /></TextField>
          <OptionSelect
            label={t.prefixes.purpose}
            options={ALLOCATION_PURPOSE_OPTIONS}
            value={editAlloc.purpose ?? "Server"}
            onChange={(v) => setEditAlloc((p: any) => ({...p, purpose: v}))}
          />
          <TextField value={editAlloc.expiryDate ?? ""} onChange={(v) => setEditAlloc((p: any) => ({...p, expiryDate: v}))}><Label>Expiry Date</Label><Input type="date" /></TextField>
          <TextField value={editAlloc.notes ?? ""} onChange={(v) => setEditAlloc((p: any) => ({...p, notes: v}))}><Label>{t.prefixes.notes}</Label><Input /></TextField>
        </SimpleModal>
      )}

      {/* ── Bulk Edit Allocations Modal ── */}
      <SimpleModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} title={`Bulk edit ${selectedAllocationIds.length} IPs`} footer={<>
        <Button variant="ghost" onPress={() => setShowBulkEdit(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleBulkUpdate}>{t.common.save}</Button>
      </>}>
        <p className="text-muted text-sm">Only selected fields will be changed. Empty assignee and expiry keep current values.</p>
        <OptionSelect
          labels={OPTION_LABELS}
          label={t.common.status}
          options={[KEEP_VALUE, ...ALLOCATION_STATUS_OPTIONS]}
          value={bulkForm.status}
          onChange={(v) => setBulkForm((p) => ({...p, status: v}))}
        />
        <TextField value={bulkForm.assignee} onChange={(v) => setBulkForm((p) => ({...p, assignee: v}))}><Label>{t.prefixes.assignee}</Label><Input placeholder="Leave empty to keep current assignee" /></TextField>
        <OptionSelect
          labels={OPTION_LABELS}
          label={t.prefixes.purpose}
          options={[KEEP_VALUE, ...ALLOCATION_PURPOSE_OPTIONS]}
          value={bulkForm.purpose}
          onChange={(v) => setBulkForm((p) => ({...p, purpose: v}))}
        />
        <TextField value={bulkForm.expiryDate} onChange={(v) => setBulkForm((p) => ({...p, expiryDate: v}))}><Label>Expiry Date</Label><Input type="date" /></TextField>
      </SimpleModal>
    </div>
  );
}
