import "server-only";

import { sha256CanonicalJson } from "@/lib/repositories/hash";

export const createInternalTaskAnalysisId = ({
  idempotencyKey,
  repositoryBindingId,
  scope,
}: {
  idempotencyKey: string;
  repositoryBindingId: string;
  scope: "assessment" | "quote";
}): string =>
  `${scope}-${sha256CanonicalJson({
    idempotencyKey,
    repositoryBindingId,
  })}`;
