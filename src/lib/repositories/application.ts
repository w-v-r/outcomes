import "server-only";

import { type CustomerPrincipal } from "@/lib/api-keys/service";
import { ControlPlaneError } from "@/lib/control-plane/errors";
import {
  captureRepositoryPreflight,
  RepositoryCaptureError,
  type RepositoryCaptureInput,
  type RepositoryCaptureResult,
} from "@/lib/repositories/capture";
import { createAdminClient } from "@/lib/supabase/admin";

import { type RepositoryCaptureRequest } from "../control-plane/schemas";

export type InstallationGenerationDto = {
  account: {
    login: string;
    type: string;
  };
  created_at: string;
  installation_generation_id: string;
  repository_selection: "all" | "selected";
  status: "active" | "suspended";
};

type InstallationDiscoveryStore = {
  listActive: (userId: string) => Promise<
    Array<{
      account_login: string;
      account_type: string;
      created_at: string;
      id: string;
      repository_selection: "all" | "selected";
      suspended_at: string | null;
    }>
  >;
};

type RepositoryApplicationDependencies = {
  capture: (
    input: RepositoryCaptureInput,
  ) => Promise<RepositoryCaptureResult>;
  installationStore: InstallationDiscoveryStore;
};

const createInstallationDiscoveryStore =
  (): InstallationDiscoveryStore => {
    const admin = createAdminClient();

    if (!admin) {
      throw new ControlPlaneError({
        code: "service_unavailable",
        message: "Repository discovery is not configured.",
        status: 503,
      });
    }

    return {
      listActive: async (userId) => {
        const { data, error } = await admin
          .from("github_app_installations")
          .select(
            "id, account_login, account_type, repository_selection, suspended_at, created_at",
          )
          .eq("user_id", userId)
          .is("disconnected_at", null)
          .order("created_at", { ascending: false });

        if (error) {
          throw new ControlPlaneError({
            code: "database_error",
            message: "GitHub App installations could not be loaded.",
            status: 500,
          });
        }

        return data ?? [];
      },
    };
  };

export const createRepositoryApplicationService = (
  dependencies: RepositoryApplicationDependencies,
) => ({
  captureBinding: async (
    principal: CustomerPrincipal,
    input: RepositoryCaptureRequest,
  ) => {
    try {
      const result = await dependencies.capture({
        baseBranch: input.base_branch,
        baseSha: input.base_sha,
        repositoryUrl: input.repository_url,
        storedInstallationId: input.stored_installation_id,
        userId: principal.userId,
      });

      return {
        binding: {
          base_branch: result.binding.baseBranch,
          base_sha: result.binding.baseSha,
          id: result.bindingId,
          manifest_hash: result.binding.manifestHash,
          repository: {
            full_name: result.binding.repository.fullName,
            github_repository_id:
              result.binding.repository.githubRepositoryId,
            url: result.binding.repository.canonicalUrl,
            visibility: result.binding.repository.visibility,
          },
          snapshot_id: result.snapshotId,
        },
      };
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        throw error;
      }

      const captureError =
        error instanceof RepositoryCaptureError
          ? error
          : error instanceof AggregateError
            ? error.errors.find(
                (item): item is RepositoryCaptureError =>
                  item instanceof RepositoryCaptureError,
              )
            : undefined;

      if (captureError) {
        const isNotOwned =
          captureError.code === "installation_not_owned";
        const isAccessDenied =
          captureError.code === "repository_access_denied";

        throw new ControlPlaneError({
          code: isNotOwned
            ? "repository_installation_not_found"
            : isAccessDenied
              ? "repository_access_denied"
              : "repository_preflight_failed",
          message: isNotOwned
            ? "The GitHub App installation was not found."
            : isAccessDenied
              ? "The GitHub App installation cannot access this repository."
              : "Repository access or immutable base preflight failed.",
          status: isNotOwned ? 404 : isAccessDenied ? 403 : 409,
        });
      }

      throw new ControlPlaneError({
        code: "repository_capture_failed",
        message: "The repository snapshot could not be captured.",
        status: 502,
      });
    }
  },
  listInstallations: async (
    principal: CustomerPrincipal,
  ): Promise<InstallationGenerationDto[]> => {
    const rows = await dependencies.installationStore.listActive(
      principal.userId,
    );

    return rows.map((row) => ({
      account: {
        login: row.account_login,
        type: row.account_type,
      },
      created_at: row.created_at,
      installation_generation_id: row.id,
      repository_selection: row.repository_selection,
      status: row.suspended_at ? "suspended" : "active",
    }));
  },
});

const createDefaultService = () =>
  createRepositoryApplicationService({
    capture: captureRepositoryPreflight,
    installationStore: createInstallationDiscoveryStore(),
  });

export const listRepositoryInstallations = async (
  principal: CustomerPrincipal,
) => createDefaultService().listInstallations(principal);

export const captureRepositoryBinding = async (
  principal: CustomerPrincipal,
  input: RepositoryCaptureRequest,
) => createDefaultService().captureBinding(principal, input);
