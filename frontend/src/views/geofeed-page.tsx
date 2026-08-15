"use client";

import type {DataGridColumn} from "@heroui-pro/react";

import {Copy, Pencil, Plus, TrashBin, ArrowDownToSquare, ArrowUpFromSquare, CircleCheck, CircleExclamation, CircleXmark, Link, ArrowShapeRight} from "@gravity-ui/icons";
import {Button, Card, Chip, Input, Label, SearchField, Spinner, TextField, toast} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useCallback, useMemo, useState} from "react";

import {getCountryDisplay} from "../lib/geo";
import {Dialog} from "../components/dialog";
import {IconButton} from "../components/icon-button";
import {RequestState} from "../components/request-state";
import {api} from "../lib/api";
import {formatGeofeedImportErrors, formatGeofeedImportSummary} from "../lib/api-display";
import type {GeofeedEntry, GeofeedQueryParams} from "../lib/api-types";
import {useCursorPage} from "../lib/use-cursor-page";
import {formatMessage, useI18n} from "../i18n";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function GeofeedPage() {
  const {t} = useI18n();
  const [search, setSearch] = useState("");
  const geofeedQuery = useMemo<GeofeedQueryParams>(() => {
    const normalizedSearch = search.trim();
    return normalizedSearch ? {search: normalizedSearch} : {};
  }, [search]);
  const {data: page, error, loadMore, loadingMore, refetch, status} = useCursorPage(
    (query, signal) => api.geofeed.list(query, signal),
    geofeedQuery,
    50,
  );
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editItem, setEditItem] = useState<GeofeedEntry | null>(null);
  const [formData, setFormData] = useState({prefix: "", countryCode: "", region: "", city: "", postalCode: ""});
  const [importCsv, setImportCsv] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    setSaving(true);
    try {
      await api.geofeed.create(formData);
      toast.success(t.common.create, {description: formData.prefix});
      setShowCreate(false);
      setFormData({prefix: "", countryCode: "", region: "", city: "", postalCode: ""});
      refetch();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
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
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [editItem, refetch, t]);

  const handleImport = useCallback(async () => {
    setSaving(true);
    try {
      const result = await api.geofeed.import(importCsv);
      const summary = formatGeofeedImportSummary(result);
      if (result.failed > 0) {
        toast.danger(summary, {description: formatGeofeedImportErrors(result.errors)});
      } else {
        toast.success(t.common.import, {description: summary});
      }
      setShowImport(false);
      setImportCsv("");
      refetch();
    } catch (err: unknown) { toast.danger(errorMessage(err)); }
    finally { setSaving(false); }
  }, [importCsv, refetch, t]);

  const handleExportCSV = useCallback(() => {
    window.open(api.geofeed.generateUrl(), "_blank");
  }, []);

  const columns = useMemo<DataGridColumn<GeofeedEntry>[]>(() => [
    {
      id: "prefix", header: t.geofeed.prefix, accessorKey: "prefix", isRowHeader: true, allowsSorting: true, minWidth: 200,
      cell: (item: GeofeedEntry) => <span className="font-mono text-sm font-medium">{item.prefix}</span>,
    },
    {
      id: "country", header: t.geofeed.country, accessorKey: "countryCode", allowsSorting: true, minWidth: 100,
      cell: (item: GeofeedEntry) => <span className="text-sm">{getCountryDisplay(item.countryCode)}</span>,
    },
    {
      id: "region", header: t.geofeed.region, accessorKey: "region", minWidth: 120,
      cell: (item: GeofeedEntry) => <span className="text-muted text-xs">{item.region || "—"}</span>,
    },
    {
      id: "city", header: t.geofeed.city, accessorKey: "city", minWidth: 120,
      cell: (item: GeofeedEntry) => <span className="text-xs">{item.city || "—"}</span>,
    },
    {
      id: "postal", header: t.geofeed.postalCode, accessorKey: "postalCode", minWidth: 80,
      cell: (item: GeofeedEntry) => <span className="text-muted text-xs tabular-nums">{item.postalCode || "—"}</span>,
    },
    {
      id: "validation", header: t.geofeed.validation, minWidth: 110,
      cell: (item: GeofeedEntry) => {
        const colorMap = {valid: "success", warning: "warning", error: "danger"} as const;
        const IconMap = {valid: CircleCheck, warning: CircleExclamation, error: CircleXmark};
        const StatusIcon = IconMap[item.validation] ?? CircleCheck;
        return <Chip color={colorMap[item.validation] ?? "default"} size="sm" variant="soft"><StatusIcon className="size-3" /> {item.validation}</Chip>;
      },
    },
    {
      id: "lastUpdated", header: t.geofeed.lastUpdated, accessorKey: "lastUpdated", minWidth: 100,
      cell: (item: GeofeedEntry) => <span className="text-muted text-xs">{formatRelativeTime(item.lastUpdated)}</span>,
    },
    {
      id: "actions", header: t.common.actions, align: "end" as const, minWidth: 100,
      cell: (item: GeofeedEntry) => (
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

  if (!page) {
    if (status === "error") {
      return (
        <div className="mx-auto max-w-7xl px-5 py-10">
          <RequestState error={error} errorTitle="Unable to load geofeed entries" onRetryAction={refetch} status={status} />
        </div>
      );
    }
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">{t.geofeed.subtitle}</p>
      <RequestState error={error} errorTitle="Unable to refresh geofeed entries" onRetryAction={refetch} status={status} />

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
            <IconButton label={t.geofeed.copyLink} size="sm" variant="secondary" onPress={() => { navigator.clipboard.writeText(api.geofeed.generateUrl()); toast.success(t.common.copied, {description: "Geofeed URL"}); }}>
              <Copy className="size-4" />
            </IconButton>
            <IconButton label={t.geofeed.openLink} size="sm" variant="secondary" onPress={() => window.open(api.geofeed.generateUrl(), "_blank")}>
              <ArrowShapeRight className="size-4" />
            </IconButton>
          </div>
        </div>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchField aria-label={t.geofeed.searchLabel} className="w-full sm:w-[220px]" name="geofeed-search" variant="secondary" onChange={setSearch}>
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
      <DataGrid aria-label="Geofeed entries" columns={columns} contentClassName="min-w-[800px]" data={page.items} getRowId={(item: GeofeedEntry) => item.id} />

      {page.nextCursor && (
        <div className="flex justify-center">
          <Button isDisabled={loadingMore} size="sm" variant="secondary" onPress={loadMore}>
            {loadingMore ? t.common.loading : t.common.loadMore}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{page?.items.length ?? 0} {t.geofeed.entries}</span>
        <span>-</span>
        <span>{new Set(page?.items.map((entry) => entry.countryCode)).size} {t.geofeed.countries}</span>
      </div>

      {/* Create */}
      <Dialog isOpen={showCreate} onClose={() => setShowCreate(false)} title={t.geofeed.addEntry} footer={<>
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
      </Dialog>

      {/* Edit */}
      <Dialog isOpen={showEdit} onClose={() => setShowEdit(false)} title={`${t.common.edit} — ${editItem?.prefix}`} footer={<>
        <Button variant="ghost" onPress={() => setShowEdit(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleUpdate}>{t.common.save}</Button>
      </>}>
        <TextField value={editItem?.countryCode ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, countryCode: v} : p)}>
          <Label>{t.geofeed.country}</Label><Input />
        </TextField>
        <TextField value={editItem?.region ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, region: v} : p)}>
          <Label>{t.geofeed.region}</Label><Input />
        </TextField>
        <TextField value={editItem?.city ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, city: v} : p)}>
          <Label>{t.geofeed.city}</Label><Input />
        </TextField>
        <TextField value={editItem?.postalCode ?? ""} onChange={(v) => setEditItem((p) => p ? {...p, postalCode: v} : p)}>
          <Label>{t.geofeed.postalCode}</Label><Input />
        </TextField>
      </Dialog>

      {/* Delete */}
      <Dialog isOpen={showDelete} onClose={() => setShowDelete(false)} title={t.common.delete} footer={<>
        <Button variant="ghost" onPress={() => setShowDelete(false)}>{t.common.cancel}</Button>
        <Button variant="danger" isDisabled={saving} onPress={handleDelete}>{t.common.delete}</Button>
      </>}>
        <p className="text-foreground">{formatMessage(t.geofeed.deleteEntryConfirm, {prefix: editItem?.prefix ?? ""})}</p>
      </Dialog>

      {/* Import CSV */}
      <Dialog isOpen={showImport} onClose={() => setShowImport(false)} title={t.geofeed.importCSV} footer={<>
        <Button variant="ghost" onPress={() => setShowImport(false)}>{t.common.cancel}</Button>
        <Button isDisabled={saving} onPress={handleImport}>{t.common.import}</Button>
      </>}>
        <p className="text-muted text-sm" id="geofeed-import-instructions">{t.geofeed.importInstructions}</p>
        <textarea
          aria-describedby="geofeed-import-instructions"
          aria-label={t.geofeed.importCsvLabel}
          className="bg-default-100 text-foreground rounded-lg p-3 font-mono text-xs min-h-[200px] w-full border-none resize-none focus:outline-none"
          placeholder="103.152.220.0/24,TW,TW-TPE,Taipei,100"
          value={importCsv}
          onChange={(e) => setImportCsv(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
