import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `@heroui-pro/react` publishes no compiled output in this environment, so
      // Vite cannot resolve it during import analysis. Point it at a local test
      // stub so view components that render a DataGrid remain testable.
      "@heroui-pro/react": fileURLToPath(new URL("./test/stubs/heroui-pro.tsx", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/vitest.setup.ts"],
  },
});
