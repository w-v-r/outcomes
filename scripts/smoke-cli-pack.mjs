#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const workspaces = [
  "@outcomes/contracts",
  "@outcomes/client",
  "@outcomes/cli",
];

const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "outcomes-cli-pack-"));
const installDirectory = mkdtempSync(
  path.join(os.tmpdir(), "outcomes-cli-install-"),
);

try {
  execFileSync("npm", ["run", "build:packages"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  for (const workspace of workspaces) {
    execFileSync(
      "npm",
      ["pack", "-w", workspace, "--pack-destination", tempDirectory],
      { cwd: repoRoot, stdio: "inherit" },
    );
  }

  const tarballs = readdirSync(tempDirectory).filter((name) =>
    name.endsWith(".tgz"),
  );

  if (tarballs.length !== workspaces.length) {
    throw new Error(
      `Expected ${workspaces.length} tarballs, found ${tarballs.length}.`,
    );
  }

  writeFileSync(
    path.join(installDirectory, "package.json"),
    `${JSON.stringify({ name: "outcomes-cli-smoke", private: true, version: "0.0.0" }, null, 2)}\n`,
  );

  execFileSync(
    "npm",
    [
      "install",
      ...tarballs.map((name) => path.join(tempDirectory, name)),
    ],
    { cwd: installDirectory, stdio: "inherit" },
  );

  const { stderr, stdout } = spawnSync(
    "node",
    [
      path.join(
        installDirectory,
        "node_modules",
        "@outcomes",
        "cli",
        "dist",
        "bin",
        "outcomes.js",
      ),
      "help",
    ],
    { encoding: "utf8" },
  );

  const combined = `${stdout ?? ""}${stderr ?? ""}`;

  if (!combined.includes("Outcomes CLI")) {
    throw new Error("Packed CLI binary did not run.");
  }

  process.stdout.write(
    `Packed CLI smoke OK (${tarballs.join(", ")})\n`,
  );
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
  rmSync(installDirectory, { force: true, recursive: true });
}
