"use client";

import {ArrowLeft, Plus, ArrowsRotateRight, Pencil, LayoutSplitColumns, ChevronRight, CircleCheck, CircleDashed, CircleExclamation, LayoutList, TrashBin, ArrowDown, ArrowUp, ArrowUpArrowDown} from "@gravity-ui/icons";
import {Button, Card, Chip, FieldError, Input, Label, ListBox, Select, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid, type DataGridColumn} from "@heroui-pro/react";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {Key, Selection} from "react-aria-components";

import {Dialog} from "../components/dialog";
import {IconButton} from "../components/icon-button";
import {RequestState} from "../components/request-state";
import {api} from "../lib/api";
import {formatSplitToastDescription} from "../lib/api-display";
import type {Allocation, AllocationHeatmap, AllocationHeatmapBucket, AllocationPage, AllocationPurpose, AllocationStatus, AllocationStatusCounts, PrefixDetailResponse, PrefixRecord} from "../lib/api-types";
import {ipSortValue, ipv4ToNumber, ipv6ToBigInt, isSubsetOf, isValidIPv4, isValidIPv6, parseCidr, validateCidr} from "../lib/cidr";
import {useApiData} from "../lib/use-api";
import {formatMessage, useI18n} from "../i18n";

const STATUS_COLORS: Record<string, "success" | "warning" | "accent" | "danger" | "default"> = {
  Active: "success", Allocated: "success", Available: "accent", Reserved: "warning", Deprecated: "danger",
};
const STATUS_ICONS: Record<string, typeof CircleDashed> = {
  Available: CircleDashed, Allocated: CircleCheck, Reserved: CircleExclamation,
};
const ALLOCATION_STATUS_OPTIONS = ["Available", "Allocated", "Reserved"] as const;
const ALLOCATION_PURPOSE_OPTIONS = ["Server", "CDN", "DNS", "Customer", "Infrastructure"] as const;
const KEEP_VALUE = "__keep__";

type AllocationCounts = {all: number; Available: number; Allocated: number; Reserved: number};
type PrefixSegment = PrefixRecord & {left: number; width: number};
type PrefixDetailData = {
  allocationHeatmap: AllocationHeatmap | null;
  allocationPage: AllocationPage;
  allocationStatusCounts: AllocationStatusCounts;
  prefix: PrefixDetailResponse;
};
type AllocationSelectionState = {readonly keys: Selection; readonly queryKey: string};

const EMPTY_ALLOCATIONS: Allocation[] = [];
const EMPTY_ALLOCATION_COUNTS: AllocationCounts = {all: 0, Available: 0, Allocated: 0, Reserved: 0};
const ALLOCATION_PAGE_SIZE = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

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

function compareIpAddresses(left: string, right: string): number {
  const leftValue = ipSortValue(left);
  const rightValue = ipSortValue(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
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

/** Child-form fields that own inline validation feedback. */
type ValidatedChildField = "cidr" | "vlan" | "gateway";

/** A validation failure bound to the exact field that produced it. */
type ChildFieldError = {field: ValidatedChildField; message: string};

type ChildFormData = {cidr: string; vlan: string; gateway: string; assignedTo: string; description: string};

const BLANK_CHILD_FORM: ChildFormData = {cidr: "", vlan: "", gateway: "", assignedTo: "", description: ""};

function validatePrefixMetadata(data: {cidr: string; vlan: string; gateway: string}, parentCidr: string): ChildFieldError | null {
  const cidr = validateCidr(data.cidr);
  if (!cidr.valid) return {field: "cidr", message: cidr.error ?? "Invalid CIDR"};

  const child = parseCidr(data.cidr);
  const parent = parseCidr(parentCidr);
  if (!child || !parent || child.version !== parent.version) return {field: "cidr", message: "Child prefix must use the same IP version as the parent"};
  if (child.prefix <= parent.prefix) return {field: "cidr", message: "Child prefix length must be greater than the parent prefix length"};
  if (!isSubsetOf(data.cidr, parentCidr)) return {field: "cidr", message: "Child prefix must be contained by the parent prefix"};

  if (data.vlan) {
    const vlan = Number(data.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return {field: "vlan", message: "VLAN must be an integer between 1 and 4094"};
  }

  if (data.gateway && !isValidIPv4(data.gateway) && !isValidIPv6(data.gateway)) {
    return {field: "gateway", message: "Gateway must be a valid IPv4 or IPv6 address"};
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
  childPrefixes: PrefixRecord[];
  onOpenPrefix: (id: string) => void;
  prefix: PrefixRecord;
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
        return {...child, left, width: Math.max(width, 0.6)} satisfies PrefixSegment;
      })
      .filter((segment): segment is PrefixSegment => segment !== null);
  }, [childPrefixes, parentRange]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold">Address Space</p>
          <p className="text-muted text-xs">Child prefix occupancy inside this prefix.</p>
        </div>
        <span className="text-muted shrink-0 whitespace-nowrap text-xs tabular-nums">{childPrefixes.length} child prefixes</span>
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

function heatmapBucketColor(bucket: AllocationHeatmapBucket): string {
  const statuses = Object.entries(bucket.counts) as Array<[AllocationStatus, number]>;
  const dominant = statuses.reduce((current, candidate) => candidate[1] > current[1] ? candidate : current);
  return dominant[1] === 0 ? "var(--default-200)" : statusColor(dominant[0]);
}

function AllocationPoolVisualization({counts, heatmap}: {counts: AllocationCounts; heatmap: AllocationHeatmap | null}) {
  const statusSegments = [
    {count: counts.Available, label: "Available", color: statusColor("Available")},
    {count: counts.Allocated, label: "Allocated", color: statusColor("Allocated")},
    {count: counts.Reserved, label: "Reserved", color: statusColor("Reserved")},
  ].filter((segment) => segment.count > 0);

  if (counts.all === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold">IP Pool</p>
          <p className="text-muted text-xs">Allocation status distribution and address order.</p>
        </div>
        <span className="text-muted shrink-0 whitespace-nowrap text-xs tabular-nums">{counts.all} IPs</span>
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
      {heatmap && (
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 overflow-hidden rounded-lg bg-default-100 p-2">
          {heatmap.buckets.map((bucket) => (
          <span
            key={bucket.index}
            className="aspect-square rounded-[2px]"
            data-testid="allocation-heatmap-bucket"
            title={`${bucket.startAddress ?? "Empty"} - ${bucket.endAddress ?? "Empty"}; Available ${bucket.counts.Available}; Allocated ${bucket.counts.Allocated}; Reserved ${bucket.counts.Reserved}`}
            style={{backgroundColor: heatmapBucketColor(bucket)}}
          />
          ))}
        </div>
      )}
    </div>
  );
}

function PrefixVisualizationCard({
  childPrefixes,
  counts,
  heatmap,
  onOpenPrefix,
  prefix,
}: {
  childPrefixes: PrefixRecord[];
  counts: AllocationCounts;
  heatmap: AllocationHeatmap | null;
  onOpenPrefix: (id: string) => void;
  prefix: PrefixRecord;
}) {
  return (
    <Card className="rounded-2xl p-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <PrefixSpaceVisualization childPrefixes={childPrefixes} onOpenPrefix={onOpenPrefix} prefix={prefix} />
        <AllocationPoolVisualization counts={counts} heatmap={heatmap} />
      </div>
    </Card>
  );
}

type SortDir = 'asc' | 'desc';
type AllocationSortColumn = "ipAddress" | "status" | "assignee" | "purpose" | "expiryDate" | "notes";
type SortState = { col: AllocationSortColumn; dir: SortDir } | null;

export function PrefixDetailPage({prefixId}: {prefixId: string}) {
  const {t} = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<AllocationStatus | "all">("all");
  const {
    data: detailData,
    error: loadError,
    refetch: loadData,
    setData: setDetailData,
    status: loadStatus,
  } = useApiData<PrefixDetailData>(async (signal) => {
    const loadedPrefix = await api.prefixes.get(prefixId, signal);
    if (!loadedPrefix.isPool && (loadedPrefix._count?.allocations ?? 0) === 0) {
      return {
        allocationHeatmap: null,
        allocationPage: {items: [], nextCursor: null},
        allocationStatusCounts: EMPTY_ALLOCATION_COUNTS,
        prefix: loadedPrefix,
      };
    }

    const allocationQuery = filter === "all"
      ? {limit: ALLOCATION_PAGE_SIZE}
      : {limit: ALLOCATION_PAGE_SIZE, status: filter};
    const [allocationPage, allocationStatusCounts, allocationHeatmap] = await Promise.all([
      api.prefixes.allocations(prefixId, allocationQuery, signal),
      api.prefixes.allocationStatusCounts(prefixId, signal),
      api.prefixes.allocationHeatmap(prefixId, signal),
    ]);
    return {
      allocationHeatmap,
      allocationPage,
      allocationStatusCounts,
      prefix: loadedPrefix,
    };
  }, [prefixId, filter]);
  const prefix = detailData?.prefix ?? null;
  const allocations = detailData?.allocationPage.items ?? EMPTY_ALLOCATIONS;
  const nextAllocationCursor = detailData?.allocationPage.nextCursor ?? null;
  const statusCounts = detailData?.allocationStatusCounts ?? EMPTY_ALLOCATION_COUNTS;
  const allCounts: AllocationCounts = {
    ...statusCounts,
    all: statusCounts.Available + statusCounts.Allocated + statusCounts.Reserved,
  };
  const [generating, setGenerating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState>({col: 'ipAddress', dir: 'asc'});
  const allocationQueryKey = `${prefixId}:${filter}`;
  const allocationQueryKeyRef = useRef(allocationQueryKey);
  const [selectionState, setSelectionState] = useState<AllocationSelectionState>({
    keys: new Set<Key>(),
    queryKey: allocationQueryKey,
  });
  const selectedAllocationKeys = useMemo<Selection>(
    () => selectionState.queryKey === allocationQueryKey ? selectionState.keys : new Set<Key>(),
    [allocationQueryKey, selectionState],
  );
  const setSelectedAllocationKeys = useCallback(
    (next: Selection | ((current: Selection) => Selection)) => {
      setSelectionState((current) => {
        const currentKeys = current.queryKey === allocationQueryKey ? current.keys : new Set<Key>();
        const nextKeys = typeof next === "function" ? next(currentKeys) : next;
        return {keys: nextKeys, queryKey: allocationQueryKey};
      });
    },
    [allocationQueryKey],
  );

  useEffect(() => {
    allocationQueryKeyRef.current = allocationQueryKey;
  }, [allocationQueryKey]);

  const toggleSort = useCallback((col: AllocationSortColumn) => {
    setSort(prev => {
      if (prev?.col === col) return prev.dir === 'asc' ? {col, dir: 'desc'} : null;
      return {col, dir: 'asc'};
    });
  }, []);

  const sortedAllocations = useMemo(() => {
    if (!sort) return allocations;
    const sorted = [...allocations].sort((a, b) => {
      if (sort.col === 'ipAddress') {
        return compareIpAddresses(a.ipAddress, b.ipAddress);
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
  const [childForm, setChildForm] = useState<ChildFormData>(BLANK_CHILD_FORM);
  const [childFieldError, setChildFieldError] = useState<ChildFieldError | null>(null);
  const childCidrInputRef = useRef<HTMLInputElement>(null);
  const childVlanInputRef = useRef<HTMLInputElement>(null);
  const childGatewayInputRef = useRef<HTMLInputElement>(null);
  const childFieldRefs = useMemo(() => ({
    cidr: childCidrInputRef,
    gateway: childGatewayInputRef,
    vlan: childVlanInputRef,
  }), []);

  // Focus lands after the commit that sets `aria-invalid` and `aria-describedby`,
  // so assistive technology announces the field together with its error.
  useEffect(() => {
    if (!childFieldError) return;
    childFieldRefs[childFieldError.field].current?.focus();
  }, [childFieldError, childFieldRefs]);
  const [editAlloc, setEditAlloc] = useState<Allocation | null>(null);
  const [showEditAlloc, setShowEditAlloc] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({assignee: "", expiryDate: "", purpose: KEEP_VALUE, status: KEEP_VALUE});
  const keepCurrentLabels = useMemo<Record<string, string>>(() => ({[KEEP_VALUE]: t.prefixes.bulkKeepCurrent}), [t]);
  const currentPrefixLen = prefix ? parseInt(prefix.cidr.split('/')[1], 10) : 0;
  const maxPrefixLength = prefix?.version === 6 ? 128 : 32;

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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
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
      toast.success(t.prefixes.split, {description: formatSplitToastDescription(result.created, t.prefixes.childrenCreated)});
      setShowSplit(false);
      loadData();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [currentPrefixLen, maxPrefixLength, prefix, prefixId, splitLen, loadData, t]);

  const openAddChildDialog = useCallback(() => {
    setChildForm(BLANK_CHILD_FORM);
    setChildFieldError(null);
    setShowAddChild(true);
  }, []);

  const closeAddChildDialog = useCallback(() => {
    setChildFieldError(null);
    setShowAddChild(false);
  }, []);

  /** Writes one child-form field and retires the inline error that field owns. */
  const updateChildField = useCallback((field: keyof ChildFormData, value: string) => {
    setChildForm((previous) => ({...previous, [field]: value}));
    setChildFieldError((previous) => previous?.field === field ? null : previous);
  }, []);

  const handleAddChild = useCallback(async () => {
    if (!prefix) return;

    const validationError = validatePrefixMetadata(childForm, prefix.cidr);
    if (validationError) {
      // The inline error is the feedback: it is durable, sits beside the field,
      // and is programmatically associated with it. A toast would add nothing
      // and, being bottom-anchored, would sit on top of this dialog's own
      // action row on a 390px-tall viewport.
      setChildFieldError(validationError);
      return;
    }

    setChildFieldError(null);

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
      closeAddChildDialog();
      loadData();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [closeAddChildDialog, prefixId, childForm, prefix, loadData, t]);

  const handleSaveAlloc = useCallback(async () => {
    if (!editAlloc) return;
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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [editAlloc, prefixId, loadData, t]);

  const selectedAllocationIds = useMemo(() => {
    if (selectedAllocationKeys === "all") return sortedAllocations.map((allocation) => allocation.id);
    const loadedIds = new Set(sortedAllocations.map((allocation) => allocation.id));
    return Array.from(selectedAllocationKeys).map(String).filter((id) => loadedIds.has(id));
  }, [selectedAllocationKeys, sortedAllocations]);

  const handleLoadMoreAllocations = useCallback(async () => {
    if (!nextAllocationCursor || loadingMore) return;
    const requestQueryKey = allocationQueryKey;
    setLoadingMore(true);
    try {
      const page = await api.prefixes.allocations(prefixId, {
        cursor: nextAllocationCursor,
        limit: ALLOCATION_PAGE_SIZE,
        ...(filter === "all" ? {} : {status: filter}),
      });
      if (allocationQueryKeyRef.current !== requestQueryKey) return;
      setDetailData((current) => current ? {
        ...current,
        allocationPage: {
          items: [...current.allocationPage.items, ...page.items],
          nextCursor: page.nextCursor,
        },
      } : current);
    } catch (err: unknown) {
      toast.danger(errorMessage(err));
    } finally {
      if (allocationQueryKeyRef.current === requestQueryKey) setLoadingMore(false);
    }
  }, [allocationQueryKey, filter, loadingMore, nextAllocationCursor, prefixId, setDetailData]);

  const handleOpenBulkEdit = useCallback(() => {
    if (selectedAllocationIds.length === 0) {
      toast.danger("Select at least one IP address first");
      return;
    }
    setBulkForm({assignee: "", expiryDate: "", purpose: KEEP_VALUE, status: KEEP_VALUE});
    setShowBulkEdit(true);
  }, [selectedAllocationIds.length]);

  const handleBulkUpdate = useCallback(async () => {
    const payload: {allocationIds: string[]; status?: AllocationStatus; purpose?: AllocationPurpose; assignee?: string; expiryDate?: string} = {allocationIds: selectedAllocationIds};
    if (bulkForm.status !== KEEP_VALUE) payload.status = bulkForm.status as AllocationStatus;
    if (bulkForm.purpose !== KEEP_VALUE) payload.purpose = bulkForm.purpose as AllocationPurpose;
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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [bulkForm, loadData, prefixId, selectedAllocationIds, setSelectedAllocationKeys]);

  const handleBulkStatusUpdate = useCallback(async (status: AllocationStatus) => {
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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [loadData, prefixId, selectedAllocationIds, setSelectedAllocationKeys]);

  const handleDeleteChild = useCallback(async (child: PrefixRecord) => {
    const childCount = child._count?.children ?? 0;
    const allocationCount = child._count?.allocations ?? 0;
    if (!confirm(`${t.prefixes.deleteWarning} ${child.cidr}\n${formatMessage(t.prefixes.cascadeWarning, {allocations: allocationCount, children: childCount})}`)) return;
    try {
      await api.prefixes.delete(child.id);
      toast.success(t.common.delete);
      loadData();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
  }, [loadData, t]);

  // ── Sortable column header ──
  const SortHeader = useCallback(({col, label}: {col: AllocationSortColumn; label: string}) => {
    const active = sort?.col === col;
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpArrowDown;
    return (
      <button className={`flex items-center gap-1 text-left transition-colors ${active ? 'text-foreground' : 'text-muted hover:text-foreground'}`} onClick={() => toggleSort(col)}>
        {label}<Icon className={`size-3 ${active ? 'text-accent' : 'text-muted'}`} />
      </button>
    );
  }, [sort, toggleSort]);

  // ── Columns for IP table ──
  const ipColumns = useMemo<DataGridColumn<Allocation>[]>(() => [
    { id: "ipAddress", header: () => <SortHeader col="ipAddress" label={t.prefixes.ipAddress} />, accessorKey: "ipAddress", minWidth: 200, isRowHeader: true,
       cell: (item: Allocation) => <span className="text-foreground font-mono text-sm font-semibold tracking-tight">{item.ipAddress}</span> },
    { id: "status", header: () => <SortHeader col="status" label={t.common.status} />, accessorKey: "status", minWidth: 130,
       cell: (item: Allocation) => { const Icon = STATUS_ICONS[item.status] ?? CircleDashed; return <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] ?? "default"}><Icon className="size-3" />{item.status}</Chip>; } },
    { id: "assignee", header: () => <SortHeader col="assignee" label={t.prefixes.assignee} />, accessorKey: "assignee", minWidth: 180,
       cell: (item: Allocation) => item.assignee ? <span className="text-foreground text-sm">{item.assignee}</span> : <span className="text-muted text-xs">—</span> },
    { id: "purpose", header: () => <SortHeader col="purpose" label={t.prefixes.purpose} />, accessorKey: "purpose", minWidth: 130,
       cell: (item: Allocation) => <Chip size="sm" variant="tertiary" color="default">{item.purpose}</Chip> },
    { id: "expiryDate", header: () => <SortHeader col="expiryDate" label="Expiry" />, accessorKey: "expiryDate", minWidth: 120,
       cell: (item: Allocation) => <span className="text-muted text-xs tabular-nums">{formatDate(item.expiryDate)}</span> },
    { id: "notes", header: t.prefixes.notes, accessorKey: "notes", minWidth: 180,
       cell: (item: Allocation) => <span className="text-muted text-xs line-clamp-1">{item.notes || ""}</span> },
    { id: "actions", header: "", minWidth: 80,
       cell: (item: Allocation) => <Button size="sm" variant="ghost" onPress={() => { setEditAlloc({...item, expiryDate: toDateInputValue(item.expiryDate)}); setShowEditAlloc(true); }}><Pencil className="size-3.5" />{t.common.edit}</Button> },
  ], [t, SortHeader]);

  if (!prefix) {
    if (loadStatus === "error") {
      return (
        <div className="mx-auto max-w-7xl px-5 py-10">
          <RequestState error={loadError} errorTitle="Unable to load prefix details" onRetryAction={loadData} status={loadStatus} />
        </div>
      );
    }
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  const children = prefix.children ?? [];
  const hasChildren = children.length > 0;
  const hasIPs = allCounts.all > 0 || prefix.isPool;
  const filterTabs: Array<{key: AllocationStatus | "all"; label: string; count: number}> = [
    {key: "all", label: t.prefixes.filterAll, count: allCounts.all},
    {key: "Available", label: t.prefixes.filterAvailable, count: allCounts.Available},
    {key: "Allocated", label: t.prefixes.filterAllocated, count: allCounts.Allocated},
    {key: "Reserved", label: t.prefixes.filterReserved, count: allCounts.Reserved},
  ];
  const utilPct = prefix.totalIPs > 0 ? Math.min((prefix.usedIPs / prefix.totalIPs) * 100, 100) : 0;
  const utilColor = utilPct > 85 ? "hsl(0 72% 51%)" : utilPct > 50 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 pb-10 pt-4">
      <RequestState error={loadError} errorTitle="Unable to refresh prefix details" onRetryAction={loadData} status={loadStatus} />
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-accent/5 via-transparent to-accent/3 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <IconButton
              label={t.prefixes.back}
              size="sm"
              variant="tertiary"
              onPress={() => {
                if (prefix.parent) router.push(`/prefixes/${prefix.parent.id}`);
                else router.push("/prefixes");
              }}
            >
              <ArrowLeft className="size-5" />
            </IconButton>
            <div className="min-w-0">
              {prefix.parent && <p className="text-muted truncate font-mono text-xs">{prefix.parent.cidr} →</p>}
              <h1 className="text-foreground break-all font-mono text-xl font-bold tracking-tight">{prefix.cidr}</h1>
            </div>
          </div>
          {/* Wraps instead of running past the viewport edge on narrow screens;
              every action stays reachable without page-level horizontal scroll. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onPress={() => { setSplitLen(String(currentPrefixLen + 1)); setShowSplit(true); }}>
              <LayoutSplitColumns className="size-4" />{t.prefixes.split}
            </Button>
            <Button size="sm" variant="secondary" onPress={openAddChildDialog}>
              <Plus className="size-4" />{t.prefixes.addChild}
            </Button>
            {prefix.version === 4 && (
              <Button size="sm" isDisabled={generating} onPress={handleGenerateIPs}>
                <Plus className="size-4" />{t.prefixes.generateIPs}
              </Button>
            )}
            <IconButton
              isDisabled={loadStatus === "loading"}
              label={t.prefixes.refresh}
              size="sm"
              variant="tertiary"
              onPress={() => void loadData()}
            >
              <ArrowsRotateRight className="size-4" />
            </IconButton>
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
      <PrefixVisualizationCard childPrefixes={children} counts={allCounts} heatmap={detailData?.allocationHeatmap ?? null} onOpenPrefix={handleOpenPrefix} prefix={prefix} />

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
             {children.map((child) => (
              <div key={child.id} className="group flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-default-50">
                <button className="text-foreground font-mono text-sm font-semibold tracking-tight hover:text-accent transition-colors" onClick={() => router.push(`/prefixes/${child.id}`)}>
                  {child.cidr}
                </button>
                <span className="bg-default-300 size-1 rounded-full" />
                <Chip size="sm" variant="soft" color={STATUS_COLORS[child.status] ?? "default"}>{child.status}</Chip>
                {child.vlan != null && <span className="text-muted text-xs">VLAN {child.vlan}</span>}
                {child.assignedTo && <span className="text-muted text-xs font-medium truncate">{child.assignedTo}</span>}
                <div className="flex-1" />
                <UtilBar total={child.totalIPs} used={child.usedIPs} />
                {(child._count?.children ?? 0) > 0 && <Chip size="sm" variant="tertiary" color="default">{child._count?.children ?? 0} sub</Chip>}
                {(child._count?.allocations ?? 0) > 0 && <Chip size="sm" variant="soft" color="accent">{child._count?.allocations ?? 0} IPs</Chip>}
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                  <IconButton label={t.common.view} size="sm" variant="tertiary" onPress={() => router.push(`/prefixes/${child.id}`)}><ChevronRight className="size-3.5" /></IconButton>
                  <IconButton label={t.common.delete} size="sm" variant="danger-soft" onPress={() => handleDeleteChild(child)}><TrashBin className="size-3.5" /></IconButton>
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
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-default-100 p-1">
              {filterTabs.map(tab => (
                <button key={tab.key} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${filter === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`} onClick={() => { allocationQueryKeyRef.current = `${prefixId}:${tab.key}`; setFilter(tab.key); setSelectedAllocationKeys(new Set()); }}>
                  {tab.label}<span className={`tabular-nums text-xs ${filter === tab.key ? "text-accent" : "text-muted"}`}>{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
            getRowId={(item: Allocation) => item.id}
            selectedKeys={selectedAllocationKeys}
            selectionMode="multiple"
            showSelectionCheckboxes
             onSelectionChange={setSelectedAllocationKeys}
           />
           {nextAllocationCursor && (
             <div className="flex justify-center">
               <Button isDisabled={loadingMore} size="sm" variant="secondary" onPress={handleLoadMoreAllocations}>
                 {loadingMore ? t.common.loading : t.common.loadMore}
               </Button>
             </div>
           )}
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
          <div className="flex flex-wrap justify-center gap-2">
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

      {/* ── Split Dialog ── */}
      <Dialog isOpen={showSplit} onClose={() => setShowSplit(false)} title={`${t.prefixes.split}: ${prefix.cidr}`} descriptionText={t.prefixes.splitDesc} footer={<>
        <Button variant="ghost" onPress={() => setShowSplit(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleSplit}>{t.prefixes.split}</Button>
      </>}>
        <TextField value={splitLen} onChange={setSplitLen}>
          <Label>{t.prefixes.newPrefixLength}</Label><Input type="number" placeholder={String(currentPrefixLen + 1)} />
        </TextField>
      </Dialog>

      {/* ── Add Child Dialog ── */}
      <Dialog isOpen={showAddChild} onClose={closeAddChildDialog} title={`${t.prefixes.addChild}: ${prefix.cidr}`} footer={<>
        <Button variant="ghost" onPress={closeAddChildDialog}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleAddChild}>{t.common.create}</Button>
      </>}>
        <TextField isInvalid={childFieldError?.field === "cidr"} value={childForm.cidr} onChange={(v) => updateChildField("cidr", v)}>
          <Label>{t.prefixes.cidr}</Label>
          <Input ref={childCidrInputRef} placeholder={`${prefix.cidr.split('/')[0]}/${currentPrefixLen + 1}`} className="font-mono" />
          <FieldError>{childFieldError?.field === "cidr" ? childFieldError.message : null}</FieldError>
        </TextField>
        <TextField isInvalid={childFieldError?.field === "vlan"} value={childForm.vlan} onChange={(v) => updateChildField("vlan", v)}>
          <Label>{t.prefixes.vlan}</Label>
          <Input ref={childVlanInputRef} type="number" />
          <FieldError>{childFieldError?.field === "vlan" ? childFieldError.message : null}</FieldError>
        </TextField>
        <TextField isInvalid={childFieldError?.field === "gateway"} value={childForm.gateway} onChange={(v) => updateChildField("gateway", v)}>
          <Label>{t.prefixes.gateway}</Label>
          <Input ref={childGatewayInputRef} className="font-mono" />
          <FieldError>{childFieldError?.field === "gateway" ? childFieldError.message : null}</FieldError>
        </TextField>
        <TextField value={childForm.assignedTo} onChange={(v) => updateChildField("assignedTo", v)}><Label>{t.prefixes.assignedTo}</Label><Input /></TextField>
        <TextField value={childForm.description} onChange={(v) => updateChildField("description", v)}><Label>{t.common.description}</Label><Input /></TextField>
      </Dialog>

      {/* ── Edit Allocation Dialog ── */}
      {editAlloc && (
        <Dialog isOpen={showEditAlloc} onClose={() => setShowEditAlloc(false)} title={editAlloc.ipAddress} footer={<>
          <Button variant="ghost" onPress={() => setShowEditAlloc(false)}>{t.common.cancel}</Button>
          <Button isDisabled={saving} onPress={handleSaveAlloc}>{t.common.save}</Button>
        </>}>
          <OptionSelect
            label={t.common.status}
            options={ALLOCATION_STATUS_OPTIONS}
            value={editAlloc.status ?? "Available"}
             onChange={(v) => setEditAlloc((p) => p ? {...p, status: v as AllocationStatus} : p)}
          />
           <TextField value={editAlloc.assignee ?? ""} onChange={(v) => setEditAlloc((p) => p ? {...p, assignee: v} : p)}><Label>{t.prefixes.assignee}</Label><Input placeholder="nginx-prod-01" /></TextField>
          <OptionSelect
            label={t.prefixes.purpose}
            options={ALLOCATION_PURPOSE_OPTIONS}
            value={editAlloc.purpose ?? "Server"}
             onChange={(v) => setEditAlloc((p) => p ? {...p, purpose: v as AllocationPurpose} : p)}
          />
           <TextField value={editAlloc.expiryDate ?? ""} onChange={(v) => setEditAlloc((p) => p ? {...p, expiryDate: v} : p)}><Label>{t.prefixes.expiryDate}</Label><Input type="date" /></TextField>
           <TextField value={editAlloc.notes ?? ""} onChange={(v) => setEditAlloc((p) => p ? {...p, notes: v} : p)}><Label>{t.prefixes.notes}</Label><Input /></TextField>
        </Dialog>
      )}

      {/* ── Bulk Edit Allocations Dialog ── */}
      <Dialog
        isOpen={showBulkEdit}
        onClose={() => setShowBulkEdit(false)}
        title={formatMessage(t.prefixes.bulkEditTitle, {count: selectedAllocationIds.length})}
        descriptionText={t.prefixes.bulkEditDesc}
        footer={<>
          <Button variant="ghost" onPress={() => setShowBulkEdit(false)}>{t.common.cancel}</Button>
          <Button isDisabled={saving} onPress={handleBulkUpdate}>{t.common.save}</Button>
        </>}
      >
        <OptionSelect
          labels={keepCurrentLabels}
          label={t.common.status}
          options={[KEEP_VALUE, ...ALLOCATION_STATUS_OPTIONS]}
          value={bulkForm.status}
          onChange={(v) => setBulkForm((p) => ({...p, status: v}))}
        />
        <TextField value={bulkForm.assignee} onChange={(v) => setBulkForm((p) => ({...p, assignee: v}))}><Label>{t.prefixes.assignee}</Label><Input placeholder={t.prefixes.bulkAssigneePlaceholder} /></TextField>
        <OptionSelect
          labels={keepCurrentLabels}
          label={t.prefixes.purpose}
          options={[KEEP_VALUE, ...ALLOCATION_PURPOSE_OPTIONS]}
          value={bulkForm.purpose}
          onChange={(v) => setBulkForm((p) => ({...p, purpose: v}))}
        />
        <TextField value={bulkForm.expiryDate} onChange={(v) => setBulkForm((p) => ({...p, expiryDate: v}))}><Label>{t.prefixes.expiryDate}</Label><Input type="date" /></TextField>
      </Dialog>
    </div>
  );
}
