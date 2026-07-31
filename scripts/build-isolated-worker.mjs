import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

await build({
  absWorkingDir: rootDirectory,
  bundle: true,
  entryPoints: ["scripts/run-isolated-cursor-worker.ts"],
  format: "esm",
  outfile: "scripts/run-isolated-cursor-worker.bundle.mjs",
  packages: "external",
  platform: "node",
  target: "node24",
});

console.log("Built scripts/run-isolated-cursor-worker.bundle.mjs");
