"use client";

import {Plus, FolderTree, Pencil, TrashBin, Magnifier} from "@gravity-ui/icons";
import {Button, Card, Chip, Input, Label, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid, type DataGridColumn} from "@heroui-pro/react";
import {useRouter} from "next/navigation";
import {useCallback, useMemo, useState} from "react";

import {SimpleModal} from "../components/simple-modal";
import {api} from "../lib/api";
import {ipv4ToNumber, ipv6ToBigInt, isValidIPv4, isValidIPv6, parseCidr, validateCidr} from "../lib/cidr";
import {useApiData} from "../lib/use-api";
import {useI18n} from "../i18n";

const STATUS_COLORS: Record<string, "success" | "warning" | "danger" | "accent" | "default"> = {
  Active: "success", Allocated: "success", Available: "accent", Reserved: "warning", Deprecated: "danger",
};

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
  const {data: roots, loading, refetch} = useApiData(() => api.prefixes.roots(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({cidr: "", rir: "APNIC", description: "", vlan: "", gateway: "", assignedTo: "", status: "Active"});
  const [search, setSearch] = useState("");

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
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [formData, refetch, t]);

  const handleEdit = useCallback((prefix: any) => { setEditItem({...prefix}); setShowEdit(true); }, []);

  const handleSaveEdit = useCallback(async () => {
    setSaving(true);
    try {
      await api.prefixes.update(editItem.id, {
        status: editItem.status, rir: editItem.rir, vlan: editItem.vlan,
        gateway: editItem.gateway, assignedTo: editItem.assignedTo, description: editItem.description,
      });
      toast.success(t.common.save);
      setShowEdit(false);
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const handleDelete = useCallback((prefix: any) => { setEditItem(prefix); setShowDelete(true); }, []);

  const handleConfirmDelete = useCallback(async () => {
    setSaving(true);
    try {
      await api.prefixes.delete(editItem.id);
      toast.success(t.common.delete);
      setShowDelete(false);
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const columns = useMemo<DataGridColumn<any>[]>(() => [
    {
      id: "cidr",
      header: "CIDR",
      accessorKey: "cidr",
      minWidth: 220,
      isRowHeader: true,
      allowsSorting: true,
      sortFn: (a: any, b: any) => compareCidr(a.cidr, b.cidr),
      cell: (item: any) => (
        <button className="text-foreground font-mono text-sm font-semibold tracking-tight hover:text-accent transition-colors" onClick={() => router.push(`/prefixes/${item.id}`)}>
          {item.cidr}
        </button>
      ),
    },
    {
      id: "version", header: "Ver", accessorKey: "version", minWidth: 70,
      cell: (item: any) => <Chip size="sm" variant="tertiary" color="default">IPv{item.version}</Chip>,
    },
    {
      id: "rir", header: "RIR", accessorKey: "rir", minWidth: 100,
      cell: (item: any) => <span className="text-foreground text-sm font-medium">{item.rir || "—"}</span>,
    },
    {
      id: "status", header: t.common.status, accessorKey: "status", minWidth: 120,
      cell: (item: any) => <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] ?? "default"}>{item.status}</Chip>,
    },
    {
      id: "assignedTo", header: t.prefixes.assignedTo, accessorKey: "assignedTo", minWidth: 160,
      cell: (item: any) => item.assignedTo ? <span className="text-foreground text-sm">{item.assignedTo}</span> : <span className="text-muted text-xs">—</span>,
    },
    {
      id: "children", header: t.prefixes.childPrefixes, minWidth: 100,
      cell: (item: any) => {
        const count = item._count?.children ?? 0;
        return count > 0
          ? <Chip size="sm" variant="soft" color="accent">{count}</Chip>
          : <span className="text-muted text-xs">0</span>;
      },
    },
    {
      id: "totalIPs", header: "IPs", accessorKey: "totalIPs", minWidth: 100,
      cell: (item: any) => <span className="text-foreground tabular-nums text-sm">{formatIPCount(item.totalIPs)}</span>,
    },
    {
      id: "utilization", header: t.dashboard.utilization, minWidth: 160,
      cell: (item: any) => <UtilBar total={item.totalIPs} used={item.usedIPs} />,
    },
    {
      id: "actions", header: "", minWidth: 90,
      cell: (item: any) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onPress={() => handleEdit(item)}><Pencil className="size-3.5" /></Button>
          <Button size="sm" variant="danger-soft" onPress={() => handleDelete(item)}><TrashBin className="size-3.5" /></Button>
        </div>
      ),
    },
  ], [t, handleEdit, handleDelete, router]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const rootList = (roots as any[]) ?? [];
  const q = search.toLowerCase().trim();
  const filteredList = q
    ? rootList.filter(p =>
        p.cidr.toLowerCase().includes(q) ||
        (p.rir ?? '').toLowerCase().includes(q) ||
        (p.status ?? '').toLowerCase().includes(q) ||
        (p.assignedTo ?? '').toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      )
    : rootList;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 pb-10 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted shrink-0 text-sm">{t.prefixes.subtitle}</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Magnifier className="text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <input
              className="bg-default-100 text-foreground placeholder:text-muted h-8 w-56 rounded-lg pl-8 pr-3 text-sm outline-none transition-colors focus:bg-default-200 focus:ring-1 focus:ring-accent"
              placeholder={t.common.search}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button size="sm" onPress={() => { setFormData({cidr: "", rir: "APNIC", description: "", vlan: "", gateway: "", assignedTo: "", status: "Active"}); setShowCreate(true); }}>
            <Plus className="size-4" />{t.prefixes.addRoot}
          </Button>
        </div>
      </div>

      {/* Table or Empty */}
      {filteredList.length === 0 ? (
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
          data={filteredList}
          defaultSortDescriptor={{column: "cidr", direction: "ascending"}}
          getRowId={(item: any) => item.id}
        />
      )}

      {/* Create Modal */}
      <SimpleModal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t.prefixes.addRoot} footer={<>
        <Button variant="ghost" onPress={() => setShowCreate(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleCreate}>{t.common.create}</Button>
      </>}>
        <TextField value={formData.cidr} onChange={(v) => setFormData(p => ({...p, cidr: v}))}><Label>CIDR</Label><Input placeholder="103.152.220.0/22" className="font-mono" /></TextField>
        <TextField value={formData.rir} onChange={(v) => setFormData(p => ({...p, rir: v}))}><Label>RIR</Label><Input placeholder="APNIC" /></TextField>
        <TextField value={formData.vlan} onChange={(v) => setFormData(p => ({...p, vlan: v}))}><Label>VLAN</Label><Input placeholder="100" type="number" /></TextField>
        <TextField value={formData.gateway} onChange={(v) => setFormData(p => ({...p, gateway: v}))}><Label>Gateway</Label><Input placeholder="103.152.220.1" className="font-mono" /></TextField>
        <TextField value={formData.assignedTo} onChange={(v) => setFormData(p => ({...p, assignedTo: v}))}><Label>{t.prefixes.assignedTo}</Label><Input placeholder="Web Cluster A" /></TextField>
        <TextField value={formData.description} onChange={(v) => setFormData(p => ({...p, description: v}))}><Label>{t.common.description}</Label><Input /></TextField>
      </SimpleModal>

      {/* Edit Modal */}
      {editItem && (
        <SimpleModal isOpen={showEdit} onClose={() => setShowEdit(false)} title={`${t.common.edit}: ${editItem.cidr}`} footer={<>
          <Button variant="ghost" onPress={() => setShowEdit(false)}>{t.common.cancel}</Button>
          <Button isDisabled={saving} onPress={handleSaveEdit}>{t.common.save}</Button>
        </>}>
          <TextField value={editItem.status ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, status: v}))}><Label>{t.common.status}</Label><Input /></TextField>
          <TextField value={editItem.rir ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, rir: v}))}><Label>RIR</Label><Input /></TextField>
          <TextField value={editItem.assignedTo ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, assignedTo: v}))}><Label>{t.prefixes.assignedTo}</Label><Input /></TextField>
          <TextField value={editItem.description ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, description: v}))}><Label>{t.common.description}</Label><Input /></TextField>
        </SimpleModal>
      )}

      {/* Delete Confirm */}
      {editItem && (
        <SimpleModal isOpen={showDelete} onClose={() => setShowDelete(false)} title={t.common.confirmDelete} footer={<>
          <Button variant="ghost" onPress={() => setShowDelete(false)}>{t.common.cancel}</Button>
          <Button variant="danger" isDisabled={saving} onPress={handleConfirmDelete}>{t.common.delete}</Button>
        </>}>
          <div className="space-y-2 text-sm">
            <p>{t.prefixes.deleteWarning} <strong className="font-mono">{editItem.cidr}</strong></p>
            <p className="text-muted">
              Children: {editItem._count?.children ?? 0}; Allocations: {editItem._count?.allocations ?? 0}. Cascade delete cannot be undone.
            </p>
          </div>
        </SimpleModal>
      )}
    </div>
  );
}
