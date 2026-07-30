const GITHUB_HOSTNAME = "github.com";
const GITHUB_REPOSITORY_PATH_PATTERN =
  /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu;

export type GitHubRepository = {
  fullName: string;
  name: string;
  owner: string;
  url: string;
};

export const normalizeGitHubRepositoryUrl = (
  value: string,
): string | null => {
  const trimmedValue = value.trim().replace(/\.git$/u, "");
  const sshMatch = trimmedValue.match(
    /^git@github\.com:([a-z0-9_.-]+\/[a-z0-9_.-]+)$/iu,
  );

  if (sshMatch?.[1]) {
    return `https://${GITHUB_HOSTNAME}/${sshMatch[1].toLowerCase()}`;
  }

  const httpsMatch = trimmedValue.match(
    /^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/?$/iu,
  );
  const repositoryPath = httpsMatch?.[1];

  if (
    !repositoryPath ||
    !GITHUB_REPOSITORY_PATH_PATTERN.test(repositoryPath)
  ) {
    return null;
  }

  return `https://${GITHUB_HOSTNAME}/${repositoryPath.toLowerCase()}`;
};

export const parseGitHubRepository = (
  value: string,
): GitHubRepository | null => {
  const url = normalizeGitHubRepositoryUrl(value);

  if (!url) {
    return null;
  }

  const [owner, name] = new URL(url).pathname.slice(1).split("/");

  if (!owner || !name) {
    return null;
  }

  return {
    fullName: `${owner}/${name}`,
    name,
    owner,
    url,
  };
};
