import "server-only";

import { createHash } from "node:crypto";

export const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const serializeCanonicalJson = (
  value: unknown,
  seen: Set<object>,
): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot represent non-finite numbers.");
    }

    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new Error("Canonical JSON only supports JSON values.");
  }

  if (seen.has(value)) {
    throw new Error("Canonical JSON cannot represent cyclic values.");
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item) => serializeCanonicalJson(item, seen))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Canonical JSON only supports plain objects.");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort(compareCodeUnits)
      .map((key) => {
        const item = record[key];

        if (item === undefined) {
          throw new Error("Canonical JSON cannot represent undefined values.");
        }

        return `${JSON.stringify(key)}:${serializeCanonicalJson(item, seen)}`;
      });

    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalJson = (value: unknown): string =>
  serializeCanonicalJson(value, new Set());

export const sha256CanonicalJson = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
