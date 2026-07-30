import "server-only";

import { z } from "zod";

import {
  repositoryManifestSchema,
  type RepositoryManifest,
} from "@/lib/pricing/domain";
import { parseGitHubRepository } from "@/lib/repositories/github";
import { sha256CanonicalJson } from "@/lib/repositories/hash";
import {
  githubBranchSchema,
  githubShaSchema,
  sha256Schema,
} from "@outcomes/contracts";

export { githubBranchSchema };

export const REPOSITORY_BINDING_SCHEMA_VERSION = 1 as const;
export const REPOSITORY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const positiveGitHubIdSchema = z.number().int().positive().safe();

export const githubRepositoryIdentitySchema = z
  .object({
    canonicalUrl: z.string().url().max(300),
    fullName: z
      .string()
      .max(255)
      .regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u),
    githubRepositoryId: positiveGitHubIdSchema,
    visibility: z.enum(["public", "private", "internal"]),
  })
  .strict()
  .superRefine((repository, context) => {
    const parsedRepository = parseGitHubRepository(repository.canonicalUrl);

    if (
      !parsedRepository ||
      parsedRepository.url !== repository.canonicalUrl ||
      parsedRepository.fullName !== repository.fullName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Repository URL and full name must be the same canonical GitHub repository.",
      });
    }
  });

export const calculateRepositoryManifestHash = (
  manifest: RepositoryManifest,
): string => sha256CanonicalJson(repositoryManifestSchema.parse(manifest));

export const repositorySnapshotSchema = z
  .object({
    commitSha: githubShaSchema,
    manifest: repositoryManifestSchema.strict(),
    manifestHash: sha256Schema,
    repository: githubRepositoryIdentitySchema,
    scanner: z
      .object({
        id: z.string().trim().min(1).max(120),
        version: z.string().trim().min(1).max(80),
      })
      .strict(),
    schemaVersion: z.literal(REPOSITORY_SNAPSHOT_SCHEMA_VERSION),
    treeSha: githubShaSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.manifest.snapshot.commitSha !== snapshot.commitSha) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Manifest commit SHA does not match the snapshot commit SHA.",
        path: ["manifest", "snapshot", "commitSha"],
      });
    }

    if (
      snapshot.manifest.source.url !== snapshot.repository.canonicalUrl ||
      snapshot.manifest.source.ref !== snapshot.commitSha
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Manifest source must identify the snapshot repository and exact commit.",
        path: ["manifest", "source"],
      });
    }

    if (
      snapshot.manifestHash !==
      calculateRepositoryManifestHash(snapshot.manifest)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Repository snapshot manifest hash does not match its manifest.",
        path: ["manifestHash"],
      });
    }
  });

export const repositoryBindingSchema = z
  .object({
    accessBinding: z
      .object({
        githubInstallationId: positiveGitHubIdSchema,
        provider: z.literal("github_app"),
        storedInstallationId: z.string().uuid(),
      })
      .strict(),
    baseBranch: githubBranchSchema,
    baseSha: githubShaSchema,
    manifestHash: sha256Schema,
    provider: z.literal("github"),
    repository: githubRepositoryIdentitySchema,
    schemaVersion: z.literal(REPOSITORY_BINDING_SCHEMA_VERSION),
    snapshotId: z.string().uuid(),
  })
  .strict();

export type GitHubRepositoryIdentity = z.infer<
  typeof githubRepositoryIdentitySchema
>;
export type RepositoryBinding = z.infer<typeof repositoryBindingSchema>;
export type RepositorySnapshot = z.infer<typeof repositorySnapshotSchema>;

export const parseRepositorySnapshot = (
  value: unknown,
): RepositorySnapshot => repositorySnapshotSchema.parse(value);

export const assertRepositoryBindingMatchesSnapshot = ({
  binding: bindingValue,
  snapshot: snapshotValue,
  snapshotId,
}: {
  binding: unknown;
  snapshot: unknown;
  snapshotId: string;
}): void => {
  const binding = repositoryBindingSchema.parse(bindingValue);
  const snapshot = parseRepositorySnapshot(snapshotValue);
  const parsedSnapshotId = z.string().uuid().parse(snapshotId);

  if (
    binding.snapshotId !== parsedSnapshotId ||
    binding.baseSha !== snapshot.commitSha ||
    binding.manifestHash !== snapshot.manifestHash ||
    binding.repository.canonicalUrl !== snapshot.repository.canonicalUrl ||
    binding.repository.fullName !== snapshot.repository.fullName ||
    binding.repository.githubRepositoryId !==
      snapshot.repository.githubRepositoryId ||
    binding.repository.visibility !== snapshot.repository.visibility
  ) {
    throw new Error(
      "Repository binding does not match the immutable repository snapshot.",
    );
  }
};
