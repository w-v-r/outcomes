import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/internal/task-executions/reconcile": [
      "scripts/run-isolated-cursor-worker.bundle.mjs",
      "node_modules/@cursor/sdk/**/*",
    ],
  },
  serverExternalPackages: ["@cursor/sdk"],
  transpilePackages: ["@outcomes/contracts"],
};

export default nextConfig;
