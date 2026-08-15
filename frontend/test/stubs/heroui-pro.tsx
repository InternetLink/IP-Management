import type {ReactNode} from "react";

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
  selectedKeys?: unknown;
  selectionMode?: "none" | "single" | "multiple";
  showSelectionCheckboxes?: boolean;
}

export function DataGrid<T>({columns, data, getRowId, onSelectionChange, selectedKeys, selectionMode, ...rest}: DataGridProps<T>) {
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
