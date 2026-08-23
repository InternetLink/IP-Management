import type {ReactNode} from "react";

import {Dialog} from "react-aria-components";

/**
 * Test-only stand-in for `@heroui-pro/react`.
 *
 * The Pro package publishes no compiled output in this environment, so Vite
 * cannot resolve the real specifier during import analysis. `vitest.config.ts`
 * aliases `@heroui-pro/react` to this module so view components that render a
 * DataGrid stay testable. The stub renders a plain semantic table and invokes
 * each column's `cell` renderer, which keeps row-action buttons — the triggers
 * for the migrated dialogs — reachable by accessible role.
 */
export type DataGridColumn<T> = {
  accessorKey?: string;
  align?: "start" | "center" | "end";
  allowsSorting?: boolean;
  cell?: (item: T) => ReactNode;
  header?: ReactNode | (() => ReactNode);
  id: string;
  isRowHeader?: boolean;
  minWidth?: number;
  sortFn?: (a: T, b: T) => number;
};

export interface DataGridProps<T> {
  "aria-label"?: string;
  columns: DataGridColumn<T>[];
  contentClassName?: string;
  data: T[];
  defaultSortDescriptor?: unknown;
  getRowId?: (item: T) => string;
  onSelectionChange?: (keys: unknown) => void;
  renderEmptyState?: () => ReactNode;
  selectedKeys?: unknown;
  selectionMode?: "none" | "single" | "multiple";
  showSelectionCheckboxes?: boolean;
}

export function DataGrid<T>({columns, data, getRowId, onSelectionChange, renderEmptyState, selectedKeys, selectionMode, ...rest}: DataGridProps<T>) {
  const selected = selectedKeys === "all" ? "all" : selectedKeys instanceof Set ? selectedKeys : new Set();

  return (
    <table aria-label={rest["aria-label"]}>
      <thead>
        <tr>
          {selectionMode === "multiple" && <th scope="col">Select</th>}
          {columns.map((column) => (
            <th key={column.id} scope="col">
              {typeof column.header === "function" ? column.header() : column.header ?? column.id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 && renderEmptyState ? (
          <tr>
            <td colSpan={columns.length + (selectionMode === "multiple" ? 1 : 0)}>{renderEmptyState()}</td>
          </tr>
        ) : null}
        {data.map((item, index) => (
          <tr key={getRowId ? getRowId(item) : index}>
            {selectionMode === "multiple" && (() => {
              const rowId = getRowId ? getRowId(item) : String(index);
              const label = typeof item === "object" && item !== null && "ipAddress" in item
                ? String(item.ipAddress)
                : rowId;
              return (
                <td>
                  <input
                    aria-label={`Select ${label}`}
                    checked={selected === "all" || selected.has(rowId)}
                    type="checkbox"
                    onChange={(event) => {
                      const next = selected === "all" ? new Set(data.map((row, rowIndex) => getRowId ? getRowId(row) : String(rowIndex))) : new Set(selected);
                      if (event.currentTarget.checked) next.add(rowId);
                      else next.delete(rowId);
                      onSelectionChange?.(next);
                    }}
                  />
                </td>
              );
            })()}
            {columns.map((column) => (
              <td key={column.id}>{column.cell ? column.cell(item) : null}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------------------
 * Application chrome
 *
 * `AppLayout`, `Navbar`, and `Sidebar` are stubbed structurally rather than
 * visually: jsdom performs no layout and evaluates no media queries, so the
 * real components' responsive and `matchMedia`-gated branches never run here.
 * Each stub keeps the element type and prop pass-through that the assertions
 * depend on, so class contracts and ARIA wiring stay observable.
 * ---------------------------------------------------------------------- */

type ElementProps = {children?: ReactNode; className?: string};

export const AppLayout = Object.assign(
  ({children, navbar, sidebar}: ElementProps & {navbar?: ReactNode; sidebar?: ReactNode}) => (
    <div data-slot="app-layout">
      {navbar}
      {sidebar}
      <main>{children}</main>
    </div>
  ),
  {
    MenuToggle: () => <button aria-label="Toggle navigation menu" type="button" />,
  },
);

export const Navbar = Object.assign(
  ({children}: ElementProps & {maxWidth?: string}) => <nav data-slot="navbar">{children}</nav>,
  {
    Header: ({children, className}: ElementProps) => (
      <header className={className} data-slot="navbar-header">{children}</header>
    ),
    Spacer: ({className}: ElementProps) => <div aria-hidden="true" className={className} data-slot="navbar-spacer" />,
  },
);

type SidebarMenuItemProps = ElementProps & {
  href?: string;
  id?: string;
  isCurrent?: boolean;
  textValue?: string;
};

export const Sidebar = Object.assign(
  ({children}: ElementProps) => <div data-slot="sidebar">{children}</div>,
  {
    Content: ({children}: ElementProps) => <div data-slot="sidebar-content">{children}</div>,
    Footer: ({children}: ElementProps) => <div data-slot="sidebar-footer">{children}</div>,
    Group: ({children}: ElementProps) => <div data-slot="sidebar-group">{children}</div>,
    Header: ({children}: ElementProps) => <div data-slot="sidebar-header">{children}</div>,
    Menu: ({children, ...rest}: ElementProps & {"aria-label"?: string}) => (
      <ul aria-label={rest["aria-label"]} data-slot="sidebar-menu">{children}</ul>
    ),
    MenuChip: ({children}: ElementProps) => <span data-slot="sidebar-menu-chip">{children}</span>,
    MenuIcon: ({children}: ElementProps) => <span data-slot="sidebar-menu-icon">{children}</span>,
    MenuItem: ({children, href, isCurrent, textValue}: SidebarMenuItemProps) => (
      <li>
        <a aria-current={isCurrent ? "page" : undefined} data-slot="sidebar-menu-item" href={href} title={textValue}>
          {children}
        </a>
      </li>
    ),
    MenuLabel: ({children}: ElementProps) => <span data-slot="sidebar-menu-label">{children}</span>,
    /**
     * The real `Sidebar.Mobile` renders its children inside `Sheet.Dialog`,
     * which is a react-aria-components `Dialog`. The stub reproduces that exact
     * composition — and therefore the exact accessible-name mechanism, where a
     * `Heading slot="title"` supplies `aria-labelledby` — while dropping the
     * `matchMedia` gate that never resolves to mobile under jsdom.
     */
    Mobile: ({children}: ElementProps & {backdrop?: string}) => (
      <Dialog data-slot="sidebar-mobile">{children}</Dialog>
    ),
    Trigger: () => <button aria-label="Open navigation" type="button" />,
  },
);

/* -------------------------------------------------------------------------
 * Charts and KPIs
 *
 * Recharts needs real measurement to draw, which jsdom cannot provide. These
 * stubs render an identifiable placeholder so tests can assert whether a chart
 * or its empty state was chosen, without asserting on SVG geometry.
 * ---------------------------------------------------------------------- */

export const KPI = Object.assign(
  ({children}: ElementProps) => <div data-slot="kpi">{children}</div>,
  {
    Content: ({children}: ElementProps) => <div>{children}</div>,
    Header: ({children}: ElementProps) => <div>{children}</div>,
    Title: ({children}: ElementProps) => <span>{children}</span>,
    Trend: ({children}: ElementProps & {trend?: string}) => <span>{children}</span>,
    Value: ({value}: {value: number} & Intl.NumberFormatOptions) => <span>{value}</span>,
  },
);

const ChartChild = ({children}: ElementProps) => <>{children ?? null}</>;

export const BarChart = Object.assign(
  ({children}: ElementProps & {data?: unknown; height?: number}) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  {
    Bar: () => null,
    Grid: () => null,
    Tooltip: () => null,
    TooltipContent: () => null,
    XAxis: () => null,
    YAxis: () => null,
  },
);

export const PieChart = Object.assign(
  ({children}: ElementProps & {height?: number; width?: number}) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  {
    Cell: () => null,
    Pie: ChartChild,
    Tooltip: () => null,
  },
);

export const ChartTooltip = Object.assign(
  ({children}: ElementProps & {active?: boolean}) => <div>{children}</div>,
  {
    Content: ChartChild,
    Indicator: () => null,
    Item: ChartChild,
    Label: ChartChild,
    Value: ChartChild,
  },
);
