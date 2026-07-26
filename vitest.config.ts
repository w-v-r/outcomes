import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "server-only": resolve(
        import.meta.dirname,
        "tests/support/server-only.ts",
      ),
    },
  },
  test: {
    coverage: {
      enabled: false,
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
