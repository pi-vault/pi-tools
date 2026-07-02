import type { ExtractedContent } from "./pipeline.ts";

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

const RAW_CONTENT_LIMIT = 100_000;
const MAX_DIR_ENTRIES = 200;

interface GitHubApiHeaders {
  Accept: string;
  "User-Agent": string;
  Authorization?: string;
}

function apiHeaders(): GitHubApiHeaders {
  const headers: GitHubApiHeaders = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "pi-tools",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

interface GitHubContentsFile {
  type: "file";
  name: string;
  content: string;
  encoding: string;
  size: number;
}

interface GitHubContentsDir {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
}

function buildOriginalUrl(parsed: GitHubUrl): string {
  const base = `https://github.com/${parsed.owner}/${parsed.repo}`;
  if (parsed.type === "root") return base;
  if (parsed.type === "raw" && parsed.ref && parsed.path) {
    return `${base}/blob/${parsed.ref}/${parsed.path}`;
  }
  const action = parsed.type === "blob" ? "blob" : "tree";
  if (parsed.ref && parsed.path) return `${base}/${action}/${parsed.ref}/${parsed.path}`;
  if (parsed.ref) return `${base}/${action}/${parsed.ref}`;
  return base;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDirListing(
  entries: GitHubContentsDir[],
  parsed: GitHubUrl,
): string {
  const truncated = entries.length > MAX_DIR_ENTRIES;
  const visible = entries.slice(0, MAX_DIR_ENTRIES);

  const lines: string[] = [];
  const pathLabel = parsed.path ?? "";
  const ref = parsed.ref ?? "HEAD";
  lines.push(
    `# ${parsed.owner}/${parsed.repo}${pathLabel ? `/${pathLabel}` : ""} (${ref})`,
  );
  lines.push("");

  const dirs = visible.filter((e) => e.type === "dir");
  const files = visible.filter((e) => e.type !== "dir");

  for (const dir of dirs) {
    lines.push(`  ${dir.name}/`);
  }
  for (const file of files) {
    const size = file.size > 0 ? ` (${formatSize(file.size)})` : "";
    lines.push(`  ${file.name}${size}`);
  }

  if (truncated) {
    lines.push("");
    lines.push(
      `[truncated] showing ${MAX_DIR_ENTRIES} of ${entries.length} entries`,
    );
  }

  return lines.join("\n");
}

/**
 * Tier 3: Fetch content via the GitHub REST API.
 * Uses /repos/{owner}/{repo}/contents/{path} endpoints.
 * Returns null on API errors (rate limiting, auth, etc.).
 */
export async function fetchViaApi(
  parsed: GitHubUrl,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const headers = apiHeaders();
  const refParam = parsed.ref ? `?ref=${encodeURIComponent(parsed.ref)}` : "";
  const originalUrl = buildOriginalUrl(parsed);

  if (parsed.type === "blob" || parsed.type === "raw") {
    if (!parsed.path) return null;

    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}${refParam}`;

    let response: Response;
    try {
      response = await fetch(apiUrl, { headers, signal });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const data = (await response.json()) as GitHubContentsFile;
    if (data.type !== "file") return null;

    // Binary check by extension
    if (isBinaryFile(parsed.path)) {
      return {
        text: `Binary file: ${parsed.path} (${data.size} bytes)`,
        title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
        url: originalUrl,
        extractionChain: ["github:api", "binary-skip"],
        chars: 0,
        truncated: false,
      };
    }

    // Decode base64 content
    const rawContent = Buffer.from(data.content, "base64");

    // Binary check by content
    if (isBinaryFile(parsed.path, rawContent)) {
      return {
        text: `Binary file: ${parsed.path} (${data.size} bytes)`,
        title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
        url: originalUrl,
        extractionChain: ["github:api", "binary-skip"],
        chars: 0,
        truncated: false,
      };
    }

    const text = rawContent.toString("utf-8");
    let outputText = text;
    let truncated = false;
    if (text.length > RAW_CONTENT_LIMIT) {
      outputText = text.slice(0, RAW_CONTENT_LIMIT);
      truncated = true;
    }

    return {
      text: outputText,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url: originalUrl,
      extractionChain: ["github:api"],
      chars: text.length,
      truncated,
    };
  }

  // Root or tree -- fetch directory listing
  const dirPath = parsed.path ?? "";
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${dirPath}${refParam}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, { headers, signal });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as GitHubContentsDir[];
  if (!Array.isArray(data)) return null;

  const listing = formatDirListing(data, parsed);

  return {
    text: listing,
    title: `${parsed.owner}/${parsed.repo}${dirPath ? ` - ${dirPath}` : ""}`,
    url: originalUrl,
    extractionChain: ["github:api"],
    chars: listing.length,
    truncated: false,
  };
}

/**
 * Tier 1: Rewrite a blob (or raw) URL to raw.githubusercontent.com and
 * fetch the file content directly.
 * Returns null if the URL type is not blob/raw or the fetch fails.
 */
export async function fetchRaw(
  parsed: GitHubUrl,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  if (parsed.type !== "blob" && parsed.type !== "raw") return null;
  if (!parsed.ref || !parsed.path) return null;

  // Binary check by extension before fetching
  if (isBinaryFile(parsed.path)) {
    const url = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${parsed.ref}/${parsed.path}`;
    return {
      text: `Binary file: ${parsed.path}`,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url,
      extractionChain: ["github:raw", "binary-skip"],
      chars: 0,
      truncated: false,
    };
  }

  const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${parsed.path}`;

  let response: Response;
  try {
    response = await fetch(rawUrl, { signal });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const text = await response.text();
  const originalUrl = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${parsed.ref}/${parsed.path}`;
  const totalChars = text.length;

  let outputText = text;
  let truncated = false;
  if (totalChars > RAW_CONTENT_LIMIT) {
    outputText = text.slice(0, RAW_CONTENT_LIMIT);
    truncated = true;
  }

  return {
    text: outputText,
    title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
    url: originalUrl,
    extractionChain: ["github:raw"],
    chars: totalChars,
    truncated,
  };
}
