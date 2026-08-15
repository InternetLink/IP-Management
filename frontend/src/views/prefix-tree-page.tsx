"use client";

import {Plus, FolderTree, Pencil, TrashBin} from "@gravity-ui/icons";
import {Button, Card, Chip, Input, Label, SearchField, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid, type DataGridColumn} from "@heroui-pro/react";
import {useRouter} from "next/navigation";
import {useCallback, useMemo, useState} from "react";

import {Dialog} from "../components/dialog";
import {IconButton} from "../components/icon-button";
import {RequestState} from "../components/request-state";
import {api} from "../lib/api";
import {ipv4ToNumber, ipv6ToBigInt, isValidIPv4, isValidIPv6, parseCidr, validateCidr} from "../lib/cidr";
import {useCursorPage} from "../lib/use-cursor-page";
import {formatMessage, useI18n} from "../i18n";
import type {PrefixQueryParams, PrefixRir, PrefixRecord, PrefixStatus} from "../lib/api-types";

const STATUS_COLORS: Record<string, "success" | "warning" | "danger" | "accent" | "default"> = {
  Active: "success", Allocated: "success", Available: "accent", Reserved: "warning", Deprecated: "danger",
};

type PrefixFormData = {
  cidr: string;
  rir: PrefixRir | "";
  description: string;
  vlan: string;
  gateway: string;
  assignedTo: string;
  status: PrefixStatus;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function UtilBar({total, used}: {total: number; used: number}) {
  if (total <= 0) return <Chip size="sm" variant="soft" color="accent">IPv6</Chip>;
  const pct = Math.min((used / total) * 100, 100);
  const color = pct > 85 ? "hsl(0 72% 51%)" : pct > 50 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";
  return (
    <div className="flex items-center gap-2">
      <div className="bg-default-200 h-1.5 w-24 overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all duration-500" style={{width: `${pct}%`, backgroundColor: color}} />
      </div>
      <span className="text-muted tabular-nums text-xs font-medium">{pct.toFixed(0)}%</span>
    </div>
  );
}

function formatIPCount(n: number) {
  if (n < 0) return "—";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return n.toLocaleString();
}

function validatePrefixForm(data: {cidr: string; vlan: string; gateway: string}) {
  const cidr = validateCidr(data.cidr);
  if (!cidr.valid) return cidr.error ?? "Invalid CIDR";

  if (data.vlan) {
    const vlan = Number(data.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return "VLAN must be an integer between 1 and 4094";
  }

  if (data.gateway && !isValidIPv4(data.gateway) && !isValidIPv6(data.gateway)) {
    return "Gateway must be a valid IPv4 or IPv6 address";
  }

  return null;
}

function cidrSortValue(cidr: string) {
  const parsed = parseCidr(cidr);
  if (!parsed) return {version: 0, ip: 0n, prefix: 0};

  return {
    version: parsed.version,
    ip: parsed.version === 4 ? BigInt(ipv4ToNumber(parsed.ip)) : ipv6ToBigInt(parsed.ip),
    prefix: parsed.prefix,
  };
}

function compareCidr(a: string, b: string) {
  const av = cidrSortValue(a);
  const bv = cidrSortValue(b);

  if (av.version !== bv.version) return av.version - bv.version;
  if (av.ip < bv.ip) return -1;
  if (av.ip > bv.ip) return 1;
  return av.prefix - bv.prefix;
}

export function PrefixTreePage() {
  const {t} = useI18n();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [editItem, setEditItem] = useState<PrefixRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<PrefixFormData>({cidr: "", rir: "APNIC", description: "", vlan: "", gateway: "", assignedTo: "", status: "Active"});
  const [search, setSearch] = useState("");
  const prefixQuery = useMemo<PrefixQueryParams>(() => {
    const normalizedSearch = search.trim();
    return normalizedSearch ? {search: normalizedSearch} : {};
  }, [search]);
  const {data: roots, error, loadMore, loadingMore, refetch, status} = useCursorPage(
    (query, signal) => api.prefixes.roots(query, signal),
    prefixQuery,
    50,
  );

  const handleCreate = useCallback(async () => {
    const validationError = validatePrefixForm(formData);
    if (validationError) {
      toast.danger(validationError);
      return;
    }

    setSaving(true);
    try {
      await api.prefixes.create({
        cidr: formData.cidr,
        version: formData.cidr.includes(':') ? 6 : 4,
        rir: formData.rir || undefined,
        description: formData.description,
        vlan: formData.vlan ? Number(formData.vlan) : undefined,
        gateway: formData.gateway || undefined,
        assignedTo: formData.assignedTo || undefined,
        status: formData.status,
      });
      toast.success(t.common.create);
      setShowCreate(false);
      refetch();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [formData, refetch, t]);

  const handleEdit = useCallback((prefix: PrefixRecord) => { setEditItem({...prefix}); setShowEdit(true); }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await api.prefixes.update(editItem.id, {
        status: editItem.status, rir: editItem.rir, vlan: editItem.vlan,
        gateway: editItem.gateway, assignedTo: editItem.assignedTo, description: editItem.description,
      });
      toast.success(t.common.save);
      setShowEdit(false);
      refetch();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const handleDelete = useCallback((prefix: PrefixRecord) => { setEditItem(prefix); setShowDelete(true); }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await api.prefixes.delete(editItem.id);
      toast.success(t.common.delete);
      setShowDelete(false);
      refetch();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const columns = useMemo<DataGridColumn<PrefixRecord>[]>(() => [
    {
      id: "cidr",
      header: "CIDR",
      accessorKey: "cidr",
      minWidth: 220,
      isRowHeader: true,
      allowsSorting: true,
       sortFn: (a: PrefixRecord, b: PrefixRecord) => compareCidr(a.cidr, b.cidr),
       cell: (item: PrefixRecord) => (
        <button className="text-foreground font-mono text-sm font-semibold tracking-tight hover:text-accent transition-colors" onClick={() => router.push(`/prefixes/${item.id}`)}>
          {item.cidr}
        </button>
      ),
    },
    {
      id: "version", header: "Ver", accessorKey: "version", minWidth: 70,
       cell: (item: PrefixRecord) => <Chip size="sm" variant="tertiary" color="default">IPv{item.version}</Chip>,
    },
    {
      id: "rir", header: "RIR", accessorKey: "rir", minWidth: 100,
       cell: (item: PrefixRecord) => <span className="text-foreground text-sm font-medium">{item.rir || "—"}</span>,
    },
    {
      id: "status", header: t.common.status, accessorKey: "status", minWidth: 120,
       cell: (item: PrefixRecord) => <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] ?? "default"}>{item.status}</Chip>,
    },
    {
      id: "assignedTo", header: t.prefixes.assignedTo, accessorKey: "assignedTo", minWidth: 160,
       cell: (item: PrefixRecord) => item.assignedTo ? <span className="text-foreground text-sm">{item.assignedTo}</span> : <span className="text-muted text-xs">—</span>,
    },
    {
      id: "children", header: t.prefixes.childPrefixes, minWidth: 100,
       cell: (item: PrefixRecord) => {
        const count = item._count?.children ?? 0;
        return count > 0
          ? <Chip size="sm" variant="soft" color="accent">{count}</Chip>
          : <span className="text-muted text-xs">0</span>;
      },
    },
    {
      id: "totalIPs", header: "IPs", accessorKey: "totalIPs", minWidth: 100,
       cell: (item: PrefixRecord) => <span className="text-foreground tabular-nums text-sm">{formatIPCount(item.totalIPs)}</span>,
    },
    {
      id: "utilization", header: t.dashboard.utilization, minWidth: 160,
       cell: (item: PrefixRecord) => <UtilBar total={item.totalIPs} used={item.usedIPs} />,
    },
    {
      id: "actions", header: t.common.actions, minWidth: 90,
       cell: (item: PrefixRecord) => (
        <div className="flex items-center gap-1">
          <IconButton label={t.common.edit} size="sm" variant="ghost" onPress={() => handleEdit(item)}><Pencil className="size-3.5" /></IconButton>
          <IconButton label={t.common.delete} size="sm" variant="danger-soft" onPress={() => handleDelete(item)}><TrashBin className="size-3.5" /></IconButton>
        </div>
      ),
    },
  ], [t, handleEdit, handleDelete, router]);

  if (!roots) {
    if (status === "error") {
      return (
        <div className="mx-auto max-w-7xl px-5 py-10">
          <RequestState error={error} errorTitle="Unable to load prefixes" onRetryAction={refetch} status={status} />
        </div>
      );
    }
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  const rootList = roots.items;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 pb-10 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-foreground text-2xl font-semibold">{t.nav.prefixes}</h1>
          <p className="text-muted text-sm">{t.prefixes.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <SearchField aria-label={t.common.search} className="w-56" name="prefix-search" value={search} variant="secondary" onChange={setSearch}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t.common.search} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button size="sm" onPress={() => { setFormData({cidr: "", rir: "APNIC", description: "", vlan: "", gateway: "", assignedTo: "", status: "Active"}); setShowCreate(true); }}>
            <Plus className="size-4" />{t.prefixes.addRoot}
          </Button>
        </div>
      </div>

      <RequestState error={error} errorTitle="Unable to refresh prefixes" onRetryAction={refetch} status={status} />

      {/* Table or Empty */}
      {rootList.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-20">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-default-100">
            <FolderTree className="text-muted size-8" />
          </div>
          <div className="text-center">
            <p className="text-foreground text-sm font-medium">{t.prefixes.emptyState}</p>
            <p className="text-muted mt-1 text-xs">{t.prefixes.emptyStateHint}</p>
          </div>
          <Button size="sm" onPress={() => { setFormData({cidr: "", rir: "APNIC", description: "", vlan: "", gateway: "", assignedTo: "", status: "Active"}); setShowCreate(true); }}>
            <Plus className="size-4" />{t.prefixes.addRoot}
          </Button>
        </Card>
      ) : (
        <DataGrid
          aria-label="IP Prefixes"
          columns={columns}
          contentClassName="min-w-[900px]"
           data={rootList}
          defaultSortDescriptor={{column: "cidr", direction: "ascending"}}
           getRowId={(item: PrefixRecord) => item.id}
         />
       )}

      {roots.nextCursor && (
        <div className="flex justify-center">
          <Button isDisabled={loadingMore} size="sm" variant="secondary" onPress={loadMore}>
            {loadingMore ? t.common.loading : t.common.loadMore}
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog isOpen={showCreate} onClose={() => setShowCreate(false)} title={t.prefixes.addRoot} footer={<>
        <Button variant="ghost" onPress={() => setShowCreate(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleCreate}>{t.common.create}</Button>
      </>}>
        <TextField value={formData.cidr} onChange={(v) => setFormData(p => ({...p, cidr: v}))}><Label>{t.prefixes.cidr}</Label><Input placeholder="103.152.220.0/22" className="font-mono" /></TextField>
        <TextField value={formData.rir} onChange={(v) => setFormData(p => ({...p, rir: v as PrefixRir | ""}))}><Label>{t.prefixes.rir}</Label><Input placeholder="APNIC" /></TextField>
        <TextField value={formData.vlan} onChange={(v) => setFormData(p => ({...p, vlan: v}))}><Label>{t.prefixes.vlan}</Label><Input placeholder="100" type="number" /></TextField>
        <TextField value={formData.gateway} onChange={(v) => setFormData(p => ({...p, gateway: v}))}><Label>{t.prefixes.gateway}</Label><Input placeholder="103.152.220.1" className="font-mono" /></TextField>
        <TextField value={formData.assignedTo} onChange={(v) => setFormData(p => ({...p, assignedTo: v}))}><Label>{t.prefixes.assignedTo}</Label><Input placeholder="Web Cluster A" /></TextField>
        <TextField value={formData.description} onChange={(v) => setFormData(p => ({...p, description: v}))}><Label>{t.common.description}</Label><Input /></TextField>
      </Dialog>

      {/* Edit Dialog */}
      {editItem && (
        <Dialog isOpen={showEdit} onClose={() => setShowEdit(false)} title={`${t.common.edit}: ${editItem.cidr}`} footer={<>
          <Button variant="ghost" onPress={() => setShowEdit(false)}>{t.common.cancel}</Button>
          <Button isDisabled={saving} onPress={handleSaveEdit}>{t.common.save}</Button>
        </>}>
          <TextField value={editItem.status ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, status: v as PrefixStatus} : p)}><Label>{t.common.status}</Label><Input /></TextField>
          <TextField value={editItem.rir ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, rir: v as PrefixRir} : p)}><Label>{t.prefixes.rir}</Label><Input /></TextField>
          <TextField value={editItem.assignedTo ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, assignedTo: v} : p)}><Label>{t.prefixes.assignedTo}</Label><Input /></TextField>
          <TextField value={editItem.description ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, description: v} : p)}><Label>{t.common.description}</Label><Input /></TextField>
        </Dialog>
      )}

      {/* Delete Confirm */}
      {editItem && (
        <Dialog isOpen={showDelete} onClose={() => setShowDelete(false)} title={t.common.confirmDelete} footer={<>
          <Button variant="ghost" onPress={() => setShowDelete(false)}>{t.common.cancel}</Button>
          <Button variant="danger" isDisabled={saving} onPress={handleConfirmDelete}>{t.common.delete}</Button>
        </>}>
          <div className="space-y-2 text-sm">
            <p>{t.prefixes.deleteWarning} <strong className="font-mono">{editItem.cidr}</strong></p>
            <p className="text-muted">
              {formatMessage(t.prefixes.cascadeWarning, {
                allocations: editItem._count?.allocations ?? 0,
                children: editItem._count?.children ?? 0,
              })}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
