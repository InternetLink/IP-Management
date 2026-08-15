import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

const toolsPageSource = readFileSync(
  resolve(process.cwd(), "src/views/tools-page.tsx"),
  "utf8",
);

describe("Tools page surface", () => {
  it("does not expose the inert IP Lookup control", () => {
    expect(toolsPageSource).not.toContain("IPLookup");
    expect(toolsPageSource).not.toContain('id="lookup"');
    expect(toolsPageSource).toContain('role="alert"');
    expect(toolsPageSource).toContain('aria-live="polite"');
  });
});
