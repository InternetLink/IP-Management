"use client";

import type {DataGridColumn} from "@heroui-pro/react";

import {Copy, Pencil, Plus, TrashBin, ArrowDownToSquare, ArrowUpFromSquare, CircleCheck, CircleExclamation, CircleXmark, Link, ArrowShapeRight} from "@gravity-ui/icons";
import {Button, Card, Chip, Input, Label, SearchField, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useCallback, useMemo, useState} from "react";

import {getCountryDisplay} from "../lib/geo";
import {IconButton} from "../components/icon-button";
import {SimpleModal} from "../components/simple-modal";
import {api} from "../lib/api";
import {useApiData} from "../lib/use-api";
import {useI18n} from "../i18n";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function GeofeedPage() {
  const {t} = useI18n();
  const {data: entries, loading, refetch} = useApiData(() => api.geofeed.list(), []);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [formData, setFormData] = useState({prefix: "", countryCode: "", region: "", city: "", postalCode: ""});
  const [importCsv, setImportCsv] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (!search) return entries;
    const q = search.toLowerCase();
    return (entries as any[]).filter((e) =>
      e.prefix.toLowerCase().includes(q) ||
      e.countryCode.toLowerCase().includes(q) ||
      (e.city && e.city.toLowerCase().includes(q)) ||
      (e.region && e.region.toLowerCase().includes(q))
    );
  }, [entries, search]);

  const handleCreate = useCallback(async () => {
    setSaving(true);
    try {
      await api.geofeed.create(formData);
      toast.success(t.common.create, {description: formData.prefix});
      setShowCreate(false);
      setFormData({prefix: "", countryCode: "", region: "", city: "", postalCode: ""});
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [formData, refetch, t]);

  const handleUpdate = useCallback(async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await api.geofeed.update(editItem.id, {countryCode: editItem.countryCode, region: editItem.region, city: editItem.city, postalCode: editItem.postalCode});
      toast.success(t.common.edit, {description: editItem.prefix});
      setShowEdit(false);
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const handleDelete = useCallback(async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await api.geofeed.delete(editItem.id);
      toast.success(t.common.delete, {description: editItem.prefix});
      setShowDelete(false);
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const handleImport = useCallback(async () => {
    setSaving(true);
    try {
      const result = await api.geofeed.import(importCsv);
      toast.success(t.common.import, {description: `${result.imported} entries imported`});
      setShowImport(false);
      setImportCsv("");
      refetch();
    } catch (err: any) { toast.danger(err.message); }
    finally { setSaving(false); }
  }, [importCsv, refetch, t]);

  const handleExportCSV = useCallback(() => {
    window.open(api.geofeed.generateUrl(), "_blank");
  }, []);

  const columns = useMemo<DataGridColumn<any>[]>(() => [
    {
      id: "prefix", header: t.geofeed.prefix, accessorKey: "prefix", isRowHeader: true, allowsSorting: true, minWidth: 200,
      cell: (item: any) => <span className="font-mono text-sm font-medium">{item.prefix}</span>,
    },
    {
      id: "country", header: t.geofeed.country, accessorKey: "countryCode", allowsSorting: true, minWidth: 100,
      cell: (item: any) => <span className="text-sm">{getCountryDisplay(item.countryCode)}</span>,
    },
    {
      id: "region", header: t.geofeed.region, accessorKey: "region", minWidth: 120,
      cell: (item: any) => <span className="text-muted text-xs">{item.region || "—"}</span>,
    },
    {
      id: "city", header: t.geofeed.city, accessorKey: "city", minWidth: 120,
      cell: (item: any) => <span className="text-xs">{item.city || "—"}</span>,
    },
    {
      id: "postal", header: t.geofeed.postalCode, accessorKey: "postalCode", minWidth: 80,
      cell: (item: any) => <span className="text-muted text-xs tabular-nums">{item.postalCode || "—"}</span>,
    },
    {
      id: "validation", header: t.geofeed.validation, minWidth: 110,
      cell: (item: any) => {
        const colorMap = {valid: "success", warning: "warning", error: "danger"} as const;
        const IconMap = {valid: CircleCheck, warning: CircleExclamation, error: CircleXmark};
        const StatusIcon = IconMap[item.validation as keyof typeof IconMap] ?? CircleCheck;
        return <Chip color={colorMap[item.validation as keyof typeof colorMap] ?? "default"} size="sm" variant="soft"><StatusIcon className="size-3" /> {item.validation}</Chip>;
      },
    },
    {
      id: "lastUpdated", header: t.geofeed.lastUpdated, accessorKey: "lastUpdated", minWidth: 100,
      cell: (item: any) => <span className="text-muted text-xs">{formatRelativeTime(item.lastUpdated ?? item.updatedAt)}</span>,
    },
    {
      id: "actions", header: t.common.actions, align: "end" as const, minWidth: 100,
      cell: (item: any) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label={t.common.edit} size="sm" variant="tertiary" onPress={() => { setEditItem({...item}); setShowEdit(true); }}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label={t.common.delete} size="sm" variant="danger-soft" onPress={() => { setEditItem(item); setShowDelete(true); }}>
            <TrashBin className="size-4" />
          </IconButton>
        </div>
      ),
    },
  ], [t]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">{t.geofeed.subtitle}</p>

      {/* Public Geofeed Link Card */}
      <Card className="border bg-gradient-to-r from-accent/5 to-transparent">
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10">
              <Link className="size-5 text-accent" />
            </div>
            <div>
              <p className="text-foreground text-sm font-semibold">{t.geofeed.publicLink}</p>
              <p className="text-muted text-xs">{t.geofeed.publicLinkDesc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-default-100 text-foreground rounded-lg px-3 py-1.5 font-mono text-xs select-all">
              {api.geofeed.generateUrl()}
            </code>
            <Button isIconOnly aria-label="Copy link" size="sm" variant="secondary" onPress={() => { navigator.clipboard.writeText(api.geofeed.generateUrl()); toast.success(t.common.copied, {description: "Geofeed URL"}); }}>
              <Copy className="size-4" />
            </Button>
            <Button isIconOnly aria-label="Open geofeed" size="sm" variant="secondary" onPress={() => window.open(api.geofeed.generateUrl(), "_blank")}>
              <ArrowShapeRight className="size-4" />
            </Button>
          </div>
        </div>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchField className="w-full sm:w-[220px]" name="geofeed-search" variant="secondary" onChange={setSearch}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={`${t.common.search}...`} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => setShowImport(true)}><ArrowDownToSquare className="size-4" />{t.geofeed.importCSV}</Button>
          <Button size="sm" variant="secondary" onPress={handleExportCSV}><ArrowUpFromSquare className="size-4" />{t.common.export}</Button>
          <Button size="sm" onPress={() => setShowCreate(true)}><Plus className="size-4" />{t.geofeed.addEntry}</Button>
        </div>
      </div>
      <DataGrid aria-label="Geofeed entries" columns={columns} contentClassName="min-w-[800px]" data={filtered} getRowId={(item: any) => item.id} />

      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{(entries as any[] | null)?.length ?? 0} {t.geofeed.entries}</span>
        <span>-</span>
        <span>{new Set((entries as any[] | null)?.map((e: any) => e.countryCode)).size} {t.geofeed.countries}</span>
      </div>

      {/* Create */}
      <SimpleModal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t.geofeed.addEntry} footer={<>
        <Button variant="ghost" onPress={() => setShowCreate(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleCreate}>{t.common.create}</Button>
      </>}>
        <TextField value={formData.prefix} onChange={(v) => setFormData(p => ({...p, prefix: v}))}>
          <Label>{t.geofeed.prefix}</Label><Input placeholder="103.152.220.0/24" />
        </TextField>
        <TextField value={formData.countryCode} onChange={(v) => setFormData(p => ({...p, countryCode: v}))}>
          <Label>{t.geofeed.country}</Label><Input placeholder="TW" />
        </TextField>
        <TextField value={formData.region} onChange={(v) => setFormData(p => ({...p, region: v}))}>
          <Label>{t.geofeed.region}</Label><Input placeholder="TW-TPE" />
        </TextField>
        <TextField value={formData.city} onChange={(v) => setFormData(p => ({...p, city: v}))}>
          <Label>{t.geofeed.city}</Label><Input placeholder="Taipei" />
        </TextField>
        <TextField value={formData.postalCode} onChange={(v) => setFormData(p => ({...p, postalCode: v}))}>
          <Label>{t.geofeed.postalCode}</Label><Input placeholder="100" />
        </TextField>
      </SimpleModal>

      {/* Edit */}
      <SimpleModal isOpen={showEdit} onClose={() => setShowEdit(false)} title={`${t.common.edit} — ${editItem?.prefix}`} footer={<>
        <Button variant="ghost" onPress={() => setShowEdit(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleUpdate}>{t.common.save}</Button>
      </>}>
        <TextField value={editItem?.countryCode ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, countryCode: v}))}>
          <Label>{t.geofeed.country}</Label><Input />
        </TextField>
        <TextField value={editItem?.region ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, region: v}))}>
          <Label>{t.geofeed.region}</Label><Input />
        </TextField>
        <TextField value={editItem?.city ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, city: v}))}>
          <Label>{t.geofeed.city}</Label><Input />
        </TextField>
        <TextField value={editItem?.postalCode ?? ""} onChange={(v) => setEditItem((p: any) => ({...p, postalCode: v}))}>
          <Label>{t.geofeed.postalCode}</Label><Input />
        </TextField>
      </SimpleModal>

      {/* Delete */}
      <SimpleModal isOpen={showDelete} onClose={() => setShowDelete(false)} title={t.common.delete} footer={<>
        <Button variant="ghost" onPress={() => setShowDelete(false)}>{t.common.cancel}</Button>
        <Button variant="danger" isDisabled={saving} onPress={handleDelete}>{t.common.delete}</Button>
      </>}>
        <p className="text-foreground">Delete geofeed entry <strong className="font-mono">{editItem?.prefix}</strong>?</p>
      </SimpleModal>

      {/* Import CSV */}
      <SimpleModal isOpen={showImport} onClose={() => setShowImport(false)} title={t.geofeed.importCSV} footer={<>
        <Button variant="ghost" onPress={() => setShowImport(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleImport}>{t.common.import}</Button>
      </>}>
        <p className="text-muted text-sm">Paste RFC 8805 geofeed CSV data. Format: prefix,country_code,region,city,postal_code</p>
        <textarea className="bg-default-100 text-foreground rounded-lg p-3 font-mono text-xs min-h-[200px] w-full border-none resize-none focus:outline-none" placeholder="103.152.220.0/24,TW,TW-TPE,Taipei,100" value={importCsv} onChange={(e) => setImportCsv(e.target.value)} />
      </SimpleModal>
    </div>
  );
}
