import { type GitHubInstallation } from "@/lib/github-app/client";

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
