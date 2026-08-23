"use client";

import {Card, Chip, Spinner} from "@heroui/react";
import {ChartColumn, CirclesIntersection} from "@gravity-ui/icons";
import {KPI, BarChart, PieChart, ChartTooltip, DataGrid, type DataGridColumn} from "@heroui-pro/react";
import type {ReactNode} from "react";
import {useMemo} from "react";
import {RequestState} from "../components/request-state";
import {formatIPCount} from "../lib/cidr";
import {api} from "../lib/api";
import type {AuditAction, AuditEntry} from "../lib/api-types";
import {useApiData} from "../lib/use-api";
import {useI18n} from "../i18n";

const RIR_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const AUDIT_ACTION_COLORS: Partial<Record<AuditAction, "success" | "accent" | "danger" | "warning" | "default">> = {
  Created: "success", Updated: "accent", Deleted: "danger", Imported: "warning", Exported: "default", Generated: "accent", Split: "accent",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const {t} = useI18n();
  const {data: stats, error, refetch, status} = useApiData((signal) => api.dashboard.getStats(signal), []);

  const auditColumns = useMemo<DataGridColumn<AuditEntry>[]>(() => [
    { id: "timestamp", header: t.audit.timestamp, accessorKey: "timestamp", minWidth: 120, cell: (item: AuditEntry) => <span className="text-muted tabular-nums text-xs">{formatRelativeTime(item.timestamp)}</span> },
    { id: "action", header: t.audit.action, accessorKey: "action", minWidth: 100, cell: (item: AuditEntry) => <Chip color={AUDIT_ACTION_COLORS[item.action] ?? "default"} size="sm" variant="soft">{item.action}</Chip> },
    { id: "resourceType", header: t.audit.resourceType, accessorKey: "resourceType", minWidth: 100, cell: (item: AuditEntry) => <span className="text-xs">{item.resourceType}</span> },
    { id: "resourceLabel", header: t.audit.resource, accessorKey: "resourceLabel", minWidth: 180, isRowHeader: true, cell: (item: AuditEntry) => <span className="font-mono text-xs font-medium">{item.resourceLabel}</span> },
    { id: "user", header: t.audit.user, accessorKey: "user", minWidth: 80, cell: (item: AuditEntry) => <span className="text-muted text-xs">{item.user}</span> },
  ], [t]);

  if (!stats) {
    if (status === "error") {
      return (
        <div className="mx-auto max-w-7xl px-5 py-10">
          <RequestState error={error} errorTitle="Unable to load dashboard" onRetryAction={refetch} status={status} />
        </div>
      );
    }
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  const totalIPv4 = stats.totalIPv4 ?? 0;
  const utilizationRate = stats.utilizationRate ?? 0;
  const rirDistribution = stats.rirDistribution.map((r, i) => ({...r, color: RIR_COLORS[i % RIR_COLORS.length]}));
  const allocationTrend = stats.allocationTrend;
  // A chart drawn from an all-zero series is indistinguishable from a failed
  // load, so both charts swap to explicit empty-state copy instead.
  const hasTrendData = allocationTrend.some((point) => (point.ipv4 ?? 0) > 0 || (point.ipv6 ?? 0) > 0);
  const hasRirData = rirDistribution.some((entry) => entry.value > 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
        <RequestState error={error} errorTitle="Unable to refresh dashboard" onRetryAction={refetch} status={status} />
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI>
          <KPI.Header><KPI.Title>{t.dashboard.totalIPv4}</KPI.Title></KPI.Header>
          <KPI.Content>
            <span className="text-foreground text-2xl font-semibold tabular-nums">{formatIPCount(totalIPv4)}</span>
            <KPI.Trend trend="up">+{stats.rootPrefixes ?? 0} {t.dashboard.prefixes.toLowerCase()}</KPI.Trend>
          </KPI.Content>
        </KPI>
        <KPI>
          <KPI.Header><KPI.Title>{t.dashboard.ipv6Prefixes}</KPI.Title></KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={stats.ipv6Prefixes ?? 0} />
          </KPI.Content>
        </KPI>
        <KPI>
          <KPI.Header><KPI.Title>{t.dashboard.utilization}</KPI.Title></KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={1} style="percent" value={utilizationRate} />
            <KPI.Trend trend={utilizationRate > 0.85 ? "down" : "up"}>{utilizationRate > 0.85 ? t.dashboard.high : t.dashboard.healthy}</KPI.Trend>
          </KPI.Content>
        </KPI>
        <KPI>
          <KPI.Header><KPI.Title>{t.dashboard.geofeedEntries}</KPI.Title></KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={stats.totalGeofeed ?? 0} />
            <KPI.Trend trend="up">RFC 8805</KPI.Trend>
          </KPI.Content>
        </KPI>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <Card.Header className="flex-row items-center justify-between">
            <Card.Title className="text-base">{t.dashboard.allocationTrend}</Card.Title>
            <div className="flex items-center gap-3">
              <LegendDot color="var(--chart-2)" label="IPv4" />
              <LegendDot color="var(--chart-4)" label="IPv6" />
            </div>
          </Card.Header>
          <Card.Content>
            {hasTrendData ? (
              <BarChart data={allocationTrend} height={220}>
                <BarChart.Grid vertical={false} />
                <BarChart.XAxis dataKey="month" tickMargin={8} />
                <BarChart.YAxis width={30} />
                <BarChart.Bar barSize={12} dataKey="ipv4" fill="var(--chart-2)" name="IPv4" radius={[4, 4, 0, 0]} stackId="stack" />
                <BarChart.Bar barSize={12} dataKey="ipv6" fill="var(--chart-4)" name="IPv6" radius={[4, 4, 0, 0]} stackId="stack" />
                <BarChart.Tooltip content={<BarChart.TooltipContent />} />
              </BarChart>
            ) : (
              <ChartEmptyState
                hint={t.dashboard.noTrendDataHint}
                icon={<ChartColumn className="text-muted size-6" />}
                title={t.dashboard.noTrendData}
              />
            )}
          </Card.Content>
        </Card>

        <Card className="rounded-2xl">
          <Card.Header>
            <Card.Title className="text-base">{t.dashboard.rirDistribution}</Card.Title>
            <Card.Description>{t.dashboard.rirDescription}</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col items-center gap-4">
            {hasRirData ? (
            <>
            <div className="relative">
              <PieChart height={200} width={200}>
                <PieChart.Pie cornerRadius={6} cx="50%" cy="50%" data={rirDistribution} dataKey="value" innerRadius="65%" nameKey="name" paddingAngle={-8} strokeWidth={0}>
                  {rirDistribution.map((r, idx) => (
                    <PieChart.Cell key={idx} fill={r.color} />
                  ))}
                </PieChart.Pie>
                <PieChart.Tooltip content={<RIRTooltip />} />
              </PieChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-foreground text-xl font-semibold tabular-nums">{formatIPCount(totalIPv4)}</span>
                <span className="text-muted text-xs">{t.dashboard.totalIPs}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {rirDistribution.map((entry) => (
                <div key={entry.name} className="flex items-center gap-3">
                  <span className="size-3 shrink-0 rounded-full" style={{backgroundColor: entry.color}} />
                  <span className="text-foreground flex-1 text-sm">{entry.name}</span>
                  <span className="text-foreground text-sm font-semibold tabular-nums">{formatIPCount(entry.value)}</span>
                </div>
              ))}
            </div>
            </>
            ) : (
              <ChartEmptyState
                hint={t.dashboard.noRirDataHint}
                icon={<CirclesIntersection className="text-muted size-6" />}
                title={t.dashboard.noRirData}
              />
            )}
          </Card.Content>
        </Card>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl">
          <Card.Header><Card.Title className="text-base">{t.dashboard.prefixes}</Card.Title></Card.Header>
          <Card.Content className="flex items-center gap-3">
            <span className="text-foreground text-2xl font-semibold">{stats.totalPrefixes ?? 0}</span>
            <div className="flex gap-1">
              <Chip size="sm" variant="soft" color="success">{stats.prefixStatusCounts?.Active ?? 0} {t.dashboard.active}</Chip>
              <Chip size="sm" variant="soft" color="warning">{stats.prefixStatusCounts?.Reserved ?? 0} {t.dashboard.reserved}</Chip>
            </div>
          </Card.Content>
        </Card>
        <Card className="rounded-2xl">
          <Card.Header><Card.Title className="text-base">{t.dashboard.allocated}</Card.Title></Card.Header>
          <Card.Content className="flex items-center gap-3">
            <span className="text-foreground text-2xl font-semibold">{stats.totalAllocations ?? 0}</span>
            <div className="flex gap-1">
              <Chip size="sm" variant="soft" color="success">{stats.allocAllocated ?? 0} {t.dashboard.allocated}</Chip>
              <Chip size="sm" variant="soft" color="accent">{stats.allocAvailable ?? 0} {t.dashboard.available}</Chip>
            </div>
          </Card.Content>
        </Card>
        <Card className="rounded-2xl">
          <Card.Header><Card.Title className="text-base">{t.dashboard.geofeedCoverage}</Card.Title></Card.Header>
          <Card.Content className="flex items-center gap-3">
            <span className="text-foreground text-2xl font-semibold">{stats.totalGeofeed ?? 0}</span>
            <div className="flex gap-1">
              <Chip size="sm" variant="soft" color="success">{stats.geofeedValid ?? 0} {t.dashboard.valid}</Chip>
              <Chip size="sm" variant="soft" color="warning">{stats.geofeedWarnings ?? 0} {t.dashboard.warnings}</Chip>
            </div>
          </Card.Content>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="flex flex-col gap-3">
        <span className="text-foreground text-base font-semibold">{t.dashboard.recentActivity}</span>
        <DataGrid
          aria-label="Recent activity"
          columns={auditColumns}
          contentClassName="min-w-[600px]"
          data={stats.recentAudit}
          getRowId={(item: AuditEntry) => item.id}
          renderEmptyState={() => (
            <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
              <p className="text-foreground text-sm font-medium">{t.dashboard.noRecentActivity}</p>
              <p className="text-muted text-xs">{t.dashboard.noRecentActivityHint}</p>
            </div>
          )}
        />
      </div>
    </div>
  );
}

/**
 * Explicit zero-data state for a chart card. Occupies the chart's height so the
 * dashboard grid keeps its rhythm when a series has nothing to plot.
 */
function ChartEmptyState({hint, icon, title}: {hint: string; icon: ReactNode; title: string}) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
      <div className="bg-default-100 flex size-12 items-center justify-center rounded-2xl">{icon}</div>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted max-w-xs text-xs">{hint}</p>
    </div>
  );
}

function LegendDot({color, label}: {color: string; label: string}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-3 rounded-full" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}

function RIRTooltip({active, payload}: {active?: boolean; payload?: Array<{name?: string; payload?: {fill?: string}; value?: number | string}>}) {
  const entry = payload?.[0];
  if (!active || !entry) return null;
  return (
    <ChartTooltip>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={entry.payload?.fill} />
        <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
        <ChartTooltip.Value>{formatIPCount(Number(entry.value))}</ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}
