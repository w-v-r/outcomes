import { parseArgs } from "node:util";

import { settleOutstandingBalances } from "../src/lib/billing/charge-outstanding-balance";

const main = async () => {
  const { values } = parseArgs({
    options: {
      batch: { default: "25", type: "string" },
    },
    strict: true,
  });
  const batchSize = Number(values.batch);

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("--batch must be an integer between 1 and 100.");
  }

  const result = await settleOutstandingBalances({ batchSize });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Billing settlement failed."}\n`,
  );
  process.exitCode = 1;
});
