import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";

const SRC_ROOT = resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"];

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, found);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))) found.push(full);
  }
  return found;
}

describe("SimpleModal removal", () => {
  it("no longer ships the simple-modal component file", () => {
    expect(existsSync(resolve(SRC_ROOT, "components/simple-modal.tsx"))).toBe(false);
  });

  it("has zero remaining SimpleModal or simple-modal references in src", () => {
    const offenders = collectSourceFiles(SRC_ROOT).filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("SimpleModal") || source.includes("simple-modal");
    });

    expect(offenders).toEqual([]);
  });

  it("routes every migrated view through the shared Dialog component", () => {
    for (const view of ["views/prefix-tree-page.tsx", "views/geofeed-page.tsx", "views/prefix-detail-page.tsx"]) {
      const source = readFileSync(resolve(SRC_ROOT, view), "utf8");
      expect(source).toContain('from "../components/dialog"');
    }
  });

  it("builds the Dialog on the installed @heroui/react Modal compound component", () => {
    const source = readFileSync(resolve(SRC_ROOT, "components/dialog.tsx"), "utf8");

    expect(source).toContain('from "@heroui/react"');
    for (const part of ["Modal.Backdrop", "Modal.Container", "Modal.Dialog", "Modal.Header", "Modal.Heading", "Modal.Body", "Modal.Footer"]) {
      expect(source).toContain(part);
    }
  });
});
