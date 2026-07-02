export interface GitHubUrl {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  type: "tree" | "blob" | "root" | "raw" | "unknown";
}

const NON_CONTENT_SEGMENTS = new Set([
  "issues",
  "pull",
  "pulls",
  "actions",
  "wiki",
  "settings",
  "discussions",
  "releases",
  "compare",
  "commits",
  "commit",
  "graphs",
  "network",
  "projects",
  "security",
  "packages",
  "stargazers",
  "watchers",
  "tags",
  "labels",
  "milestones",
  "archive",
  "codespaces",
  "deployments",
  "environments",
  "forks",
  "invitations",
]);

/**
 * Parse a GitHub URL into structured components.
 * Returns null if the URL is not a GitHub URL or lacks an owner/repo pair.
 * Returns type "unknown" for non-content pages (issues, PRs, etc.) that
 * should fall through to the normal extraction pipeline.
 */
export function parseGitHubUrl(url: string): GitHubUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // raw.githubusercontent.com/{owner}/{repo}/{ref}/{path...}
  if (parsed.hostname === "raw.githubusercontent.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return null;
    const [owner, repo, ref, ...rest] = segments;
    return {
      owner,
      repo,
      ref,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "raw",
    };
  }

  // Only handle github.com
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // Need at least owner/repo
  if (segments.length < 2) return null;

  const [owner, repo, action, ref, ...rest] = segments;

  // No action segment -> root
  if (!action) {
    return { owner, repo, ref: undefined, path: undefined, type: "root" };
  }

  // Content URL types
  if (action === "tree") {
    return {
      owner,
      repo,
      ref: ref ?? undefined,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "tree",
    };
  }

  if (action === "blob") {
    return {
      owner,
      repo,
      ref: ref ?? undefined,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "blob",
    };
  }

  // Non-content URL types
  if (NON_CONTENT_SEGMENTS.has(action)) {
    return { owner, repo, ref: undefined, path: undefined, type: "unknown" };
  }

  // Any other action segment we don't recognize -> unknown
  return { owner, repo, ref: undefined, path: undefined, type: "unknown" };
}
