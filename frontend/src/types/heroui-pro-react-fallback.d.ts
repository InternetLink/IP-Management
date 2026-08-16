/**
 * Type fallback for public CI, where HeroUI Pro's authenticated postinstall is
 * intentionally skipped and the package's generated dist directory is absent.
 */
declare module "@heroui-pro/react" {
  type ReactNode = import("react").ReactNode;
  type Key = import("react-aria-components").Key;
  type Selection = import("react-aria-components").Selection;
  type SortDescriptor = import("react-aria-components").SortDescriptor;

  type FallbackComponent<Props extends object = object> =
    import("react").ComponentType<
      Props &
        Omit<import("react").HTMLAttributes<HTMLElement>, keyof Props>
    >;

  interface AppLayoutProps {
    aside?: ReactNode;
    navbar?: ReactNode;
    navigate?: (href: string) => void;
    sidebar?: ReactNode;
    sidebarCollapsible?: "icon" | "none" | "offcanvas";
  }

  export const AppLayout: FallbackComponent<AppLayoutProps> & {
    readonly MenuToggle: FallbackComponent;
  };

  interface NavbarProps {
    maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  }

  export const Navbar: FallbackComponent<NavbarProps> & {
    readonly Header: FallbackComponent;
    readonly Spacer: FallbackComponent;
  };

  interface SidebarMenuItemProps {
    closeMobileOnAction?: boolean;
    forceReload?: boolean;
    href?: string;
    id?: Key;
    isCurrent?: boolean;
    textValue?: string;
    tooltip?: ReactNode;
  }

  export const Sidebar: FallbackComponent & {
    readonly Content: FallbackComponent;
    readonly Footer: FallbackComponent;
    readonly Group: FallbackComponent<{ closeMobileOnAction?: boolean }>;
    readonly Header: FallbackComponent;
    readonly Menu: FallbackComponent<{
      closeMobileOnAction?: boolean;
      reduceMotion?: boolean;
      showGuideLines?: boolean | "hover";
    }>;
    readonly MenuChip: FallbackComponent;
    readonly MenuIcon: FallbackComponent;
    readonly MenuItem: FallbackComponent<SidebarMenuItemProps>;
    readonly MenuLabel: FallbackComponent;
    readonly Mobile: FallbackComponent<{
      backdrop?: "blur" | "opaque" | "transparent";
    }>;
    readonly Trigger: FallbackComponent;
  };

  interface KPIValueProps extends Intl.NumberFormatOptions {
    value: number;
  }

  export const KPI: FallbackComponent & {
    readonly Content: FallbackComponent;
    readonly Header: FallbackComponent;
    readonly Title: FallbackComponent;
    readonly Trend: FallbackComponent<{ trend?: string }>;
    readonly Value: FallbackComponent<KPIValueProps>;
  };

  interface ChartRootProps {
    data: Record<string, number | string>[];
    height?: number;
    width?: number | `${number}%`;
  }

  export const BarChart: FallbackComponent<
    ChartRootProps & {
      layout?: "horizontal" | "vertical";
      margin?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    }
  > & {
    readonly Bar: FallbackComponent<{
      barSize?: number | string;
      dataKey?: string;
      fill?: string;
      name?: string;
      radius?: number | [number, number, number, number];
      stackId?: string | number;
    }>;
    readonly Grid: FallbackComponent<{ vertical?: boolean }>;
    readonly Tooltip: FallbackComponent<{ content?: ReactNode }>;
    readonly TooltipContent: FallbackComponent;
    readonly XAxis: FallbackComponent<{
      dataKey?: string;
      tickMargin?: number;
    }>;
    readonly YAxis: FallbackComponent<{ width?: number }>;
  };

  export const PieChart: FallbackComponent<Omit<ChartRootProps, "data">> & {
    readonly Cell: FallbackComponent<{ fill?: string }>;
    readonly Pie: FallbackComponent<{
      data?: Record<string, number | string>[];
      dataKey?: string;
      cornerRadius?: number | string;
      cx?: number | string;
      cy?: number | string;
      innerRadius?: number | string;
      nameKey?: string;
      outerRadius?: number | string;
      paddingAngle?: number;
      strokeWidth?: number;
    }>;
    readonly Tooltip: FallbackComponent<{ content?: ReactNode }>;
  };

  export const ChartTooltip: FallbackComponent<{ active?: boolean }> & {
    readonly Content: FallbackComponent;
    readonly Indicator: FallbackComponent<{ color?: string }>;
    readonly Item: FallbackComponent;
    readonly Label: FallbackComponent;
    readonly Value: FallbackComponent;
  };

  export interface DataGridColumn<T> {
    id: string;
    header: ReactNode | ((info: { sortDirection?: string }) => ReactNode);
    accessorKey?: keyof T & string;
    cell?: (item: T, column: DataGridColumn<T>) => ReactNode;
    isRowHeader?: boolean;
    allowsSorting?: boolean;
    sortFn?: (a: T, b: T) => number;
    allowsResizing?: boolean;
    width?: number | `${number}` | `${number}%` | `${number}fr`;
    minWidth?: number;
    maxWidth?: number;
    align?: "start" | "center" | "end";
    headerClassName?: string;
    cellClassName?: string;
    pinned?: "start" | "end";
  }

  export interface DataGridProps<T extends object> {
    data: T[];
    columns: DataGridColumn<T>[];
    getRowId: (item: T) => string | number;
    "aria-label": string;
    className?: string;
    contentClassName?: string;
    scrollContainerClassName?: string;
    verticalAlign?: "top" | "middle" | "bottom";
    selectionMode?: "none" | "single" | "multiple";
    selectedKeys?: Selection;
    defaultSelectedKeys?: Selection;
    onSelectionChange?: (keys: Selection) => void;
    selectionBehavior?: "toggle" | "replace";
    showSelectionCheckboxes?: boolean;
    sortDescriptor?: SortDescriptor;
    defaultSortDescriptor?: SortDescriptor;
    onSortChange?: (descriptor: SortDescriptor) => void;
    onRowAction?: (key: Key) => void;
    renderEmptyState?: () => ReactNode;
    disabledKeys?: Iterable<Key>;
    getChildren?: (item: T) => T[] | undefined;
    treeColumn?: string;
    expandedKeys?: Selection;
    defaultExpandedKeys?: Selection;
    onExpandedChange?: (keys: Selection) => void;
    treeIndent?: number;
    virtualized?: boolean;
    rowHeight?: number;
    headingHeight?: number;
  }

  export const DataGrid: <T extends object>(
    props: DataGridProps<T>,
  ) => import("react").ReactElement;

  interface SegmentProps {
    defaultSelectedKey?: Key;
    isDisabled?: boolean;
    onSelectionChange?: (key: Key) => void;
    selectedKey?: Key | null;
    size?: "sm" | "md" | "lg";
  }

  export const Segment: FallbackComponent<SegmentProps> & {
    readonly Item: FallbackComponent<{ id?: Key }>;
  };
}
