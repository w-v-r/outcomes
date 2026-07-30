import "server-only";

import { type GitHubInstallation } from "@/lib/github-app/client";

type InstallationClaimClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>;
};

export const claimGitHubInstallation = async ({
  client,
  installation,
  userId,
}: {
  client: InstallationClaimClient;
  installation: GitHubInstallation;
  userId: string;
}): Promise<void> => {
  const { error } = await client.rpc("claim_github_app_installation", {
    p_account_id: installation.accountId,
    p_account_login: installation.accountLogin,
    p_account_type: installation.accountType,
    p_app_id: installation.appId,
    p_app_slug: installation.appSlug,
    p_installation_id: installation.installationId,
    p_permissions: installation.permissions,
    p_repository_selection: installation.repositorySelection,
    p_suspended_at: installation.suspendedAt,
    p_user_id: userId,
  });

  if (error) {
    throw new Error(
      `Unable to save the GitHub App installation: ${error.message}`,
    );
  }
};
