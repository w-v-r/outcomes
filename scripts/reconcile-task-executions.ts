import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { reconcileControlPlane } from "../src/lib/control-plane/reconciliation";

const main = async () => {
  const { values } = parseArgs({
    options: {
      batch: { default: "1", type: "string" },
    },
    strict: true,
  });
  const batchSize = Number(values.batch);

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 3) {
    throw new Error("--batch must be an integer between 1 and 3.");
  }

  const result = await reconcileControlPlane({
    batchSize,
    claimedBy: `local:${process.pid}:${randomUUID()}`,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Execution reconciliation failed."}\n`,
  );
  process.exitCode = 1;
});
