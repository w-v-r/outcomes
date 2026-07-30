import "server-only";

import { type GitHubInstallation } from "@/lib/github-app/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StoredGitHubInstallation = {
  accountLogin: string;
  accountType: string;
  installationId: number;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
};

export const assertExecutionPermissions = (
  installation: GitHubInstallation,
): void => {
  if (
    installation.permissions.contents !== "write" ||
    installation.permissions.pull_requests !== "write"
  ) {
    throw new Error(
      "The Outcomes GitHub App requires write access to repository contents and pull requests.",
    );
  }

  if (installation.suspendedAt) {
    throw new Error("The Outcomes GitHub App installation is suspended.");
  }
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

  const { data: existingInstallation, error: lookupError } = await admin
    .from("github_app_installations")
    .select("user_id")
    .eq("app_id", installation.appId)
    .eq("account_id", installation.accountId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Unable to inspect the GitHub App installation: ${lookupError.message}`,
    );
  }

  if (
    existingInstallation &&
    existingInstallation.user_id !== userId
  ) {
    throw new Error(
      "This GitHub App installation is already connected to another Outcomes account.",
    );
  }

  const { error } = await admin.from("github_app_installations").upsert(
    {
      account_id: installation.accountId,
      account_login: installation.accountLogin,
      account_type: installation.accountType,
      app_id: installation.appId,
      app_slug: installation.appSlug,
      installation_id: installation.installationId,
      permissions: installation.permissions,
      repository_selection: installation.repositorySelection,
      suspended_at: installation.suspendedAt,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    {
      onConflict: "app_id,account_id",
    },
  );

  if (error) {
    throw new Error(
      `Unable to save the GitHub App installation: ${error.message}`,
    );
  }
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
