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

const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".tiff", ".tif",
  // Fonts
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  // Archives
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  // Compiled / native
  ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".lib",
  ".class", ".pyc", ".pyo", ".wasm",
  // Media
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".flac", ".ogg", ".webm",
  // Databases
  ".sqlite", ".db",
  // Documents (binary)
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

const BINARY_CHECK_SIZE = 8 * 1024; // 8KB

/**
 * Check if a file is binary based on its extension and optionally its content.
 * Extension check runs first; content check (null-byte scan in first 8KB)
 * runs only if extension is inconclusive and a buffer is provided.
 */
export function isBinaryFile(path: string, content?: Buffer): boolean {
  // Extension-based check
  const lastDot = path.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = path.slice(lastDot).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
  }

  // Content-based check: scan first 8KB for null bytes
  if (content) {
    const scanLength = Math.min(content.length, BINARY_CHECK_SIZE);
    for (let i = 0; i < scanLength; i++) {
      if (content[i] === 0x00) return true;
    }
  }

  return false;
}
