import "server-only";

import { type GitHubInstallation } from "@/lib/github-app/client";
import { claimGitHubInstallation } from "@/lib/github-app/installation-claims";
import { assertExecutionPermissions } from "@/lib/github-app/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export { assertExecutionPermissions } from "@/lib/github-app/permissions";

export type StoredGitHubInstallation = {
  accountLogin: string;
  accountType: string;
  installationId: number;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
};

export const saveGitHubInstallation = async ({
  installation,
  userId,
}: {
  installation: GitHubInstallation;
  userId: string;
}): Promise<void> => {
  assertExecutionPermissions(installation);

  const admin = createAdminClient();

  if (!admin) {
    throw new Error("Supabase admin access is not configured.");
  }

  await claimGitHubInstallation({
    client: admin,
    installation,
    userId,
  });
};

export const listGitHubInstallations = async (
  userId: string,
): Promise<StoredGitHubInstallation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_app_installations")
    .select(
      "account_login, account_type, installation_id, repository_selection, suspended_at",
    )
    .eq("user_id", userId)
    .is("disconnected_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to list GitHub App installations: ${error.message}`);
  }

  return (data ?? []).map((installation) => ({
    accountLogin: installation.account_login,
    accountType: installation.account_type,
    installationId: installation.installation_id,
    repositorySelection: installation.repository_selection,
    suspendedAt: installation.suspended_at,
  }));
};
