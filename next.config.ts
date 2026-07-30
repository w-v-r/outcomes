import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/internal/task-executions/reconcile": [
      "scripts/run-isolated-cursor-worker.ts",
      "src/lib/workers/isolated/cursor-run.ts",
      "node_modules/@cursor/sdk/**/*",
      "node_modules/tsx/dist/**/*",
      "node_modules/tsx/package.json",
    ],
  },
  serverExternalPackages: ["@cursor/sdk"],
  transpilePackages: ["@outcomes/contracts"],
};

export default nextConfig;
