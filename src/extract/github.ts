import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { promisify } from "node:util";
import { DEFAULT_GITHUB_CONFIG, type GitHubConfig } from "../config.ts";
import type { ExtractedContent } from "./pipeline.ts";

const execFileAsync = promisify(execFile);

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
  if (action === "tree" || action === "blob") {
    return {
      owner,
      repo,
      ref: ref ?? undefined,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: action,
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
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  // Archives
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  // Compiled / native
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".lib",
  ".class",
  ".pyc",
  ".pyo",
  ".wasm",
  // Media
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".flac",
  ".ogg",
  ".webm",
  // Databases
  ".sqlite",
  ".db",
  // Documents (binary)
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
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
  if (content?.subarray(0, BINARY_CHECK_SIZE).includes(0x00)) {
    return true;
  }

  return false;
}

const RAW_CONTENT_LIMIT = 100_000;
const MAX_DIR_ENTRIES = 200;

/** Truncate text to RAW_CONTENT_LIMIT chars, appending a notice within budget. */
function truncateWithNotice(text: string): { output: string; truncated: boolean } {
  if (text.length <= RAW_CONTENT_LIMIT) {
    return { output: text, truncated: false };
  }
  const notice = `\n\n[truncated] showing ${RAW_CONTENT_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} chars`;
  const output = text.slice(0, RAW_CONTENT_LIMIT - notice.length) + notice;
  return { output, truncated: true };
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
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

function formatDirListing(entries: GitHubContentsDir[], parsed: GitHubUrl): string {
  const truncated = entries.length > MAX_DIR_ENTRIES;
  const visible = entries.slice(0, MAX_DIR_ENTRIES);

  const lines: string[] = [];
  const pathLabel = parsed.path ?? "";
  const ref = parsed.ref ?? "HEAD";
  lines.push(`# ${parsed.owner}/${parsed.repo}${pathLabel ? `/${pathLabel}` : ""} (${ref})`);
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
    lines.push(`[truncated] showing ${MAX_DIR_ENTRIES} of ${entries.length} entries`);
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

    // Decode base64 content; check binary by extension then content
    const rawContent = Buffer.from(data.content, "base64");
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
    const { output, truncated } = truncateWithNotice(text);

    return {
      text: output,
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
  const { output, truncated } = truncateWithNotice(text);

  return {
    text: output,
    title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
    url: originalUrl,
    extractionChain: ["github:raw"],
    chars: totalChars,
    truncated,
  };
}

// ── Clone cache (Tier 2) ──────────────────────────────────────────────────────

const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "__pycache__",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
]);

const README_NAMES = ["README.md", "README", "README.txt", "readme.md"];
const README_LIMIT = 8_000;
const CACHE_BASE = nodePath.join(os.tmpdir(), "pi-tools-github-cache");

// Session-scoped map of cloned repos (owner/repo@ref -> local path)
let cloneRegistry = new Map<string, string>();

/** Test helper: reset the clone registry between tests. */
export function _resetCloneCache(): void {
  cloneRegistry = new Map();
}

/**
 * List directory contents of a clone directory with noise filtering.
 * If includeReadme is true, prepend README content (for root URLs).
 */
export function listCloneDir(
  cloneDir: string,
  owner: string,
  repo: string,
  ref: string,
  includeReadme = false,
): string {
  const lines: string[] = [];
  lines.push(`# ${owner}/${repo} (${ref})`);
  lines.push("");

  if (includeReadme) {
    for (const name of README_NAMES) {
      const readmePath = nodePath.join(cloneDir, name);
      if (fs.existsSync(readmePath)) {
        let readmeContent = fs.readFileSync(readmePath, "utf-8");
        if (readmeContent.length > README_LIMIT) {
          readmeContent =
            readmeContent.slice(0, README_LIMIT) +
            `\n\n[truncated] README showing ${README_LIMIT.toLocaleString()} of ${readmeContent.length.toLocaleString()} chars`;
        }
        lines.push(readmeContent);
        lines.push("");
        lines.push("---");
        lines.push("");
        break;
      }
    }
  }

  lines.push("## Files");
  lines.push("");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cloneDir, { withFileTypes: true });
  } catch {
    return lines.join("\n");
  }

  const filtered = entries.filter((e) => !NOISE_DIRS.has(e.name));
  const dirs = filtered.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = filtered
    .filter((e) => !e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const all = [...dirs, ...files];
  const truncated = all.length > MAX_DIR_ENTRIES;
  const visible = all.slice(0, MAX_DIR_ENTRIES);

  for (const entry of visible) {
    if (entry.isDirectory()) {
      lines.push(`  ${entry.name}/`);
    } else {
      lines.push(`  ${entry.name}`);
    }
  }

  if (truncated) {
    lines.push("");
    lines.push(`[truncated] showing ${MAX_DIR_ENTRIES} of ${all.length} entries`);
  }

  return lines.join("\n");
}

/**
 * Read a single file from a clone directory.
 * Returns binary placeholder for binary files.
 */
export function readCloneFile(cloneDir: string, filePath: string): string {
  const fullPath = nodePath.join(cloneDir, filePath);

  if (!fs.existsSync(fullPath)) {
    return `File not found: ${filePath}`;
  }

  const stat = fs.statSync(fullPath);

  if (isBinaryFile(filePath)) {
    return `Binary file: ${filePath} (${stat.size} bytes)`;
  }

  const buf = fs.readFileSync(fullPath);

  if (isBinaryFile(filePath, buf)) {
    return `Binary file: ${filePath} (${stat.size} bytes)`;
  }

  const text = buf.toString("utf-8");
  const { output } = truncateWithNotice(text);
  return output;
}

async function getRepoSizeMB(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const headers = apiHeaders();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const response = await fetch(apiUrl, { headers, signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { size: number };
    return data.size / 1024; // API returns KB
  } catch {
    return null;
  }
}

function isValidRef(ref: string): boolean {
  if (ref.length === 0 || ref.startsWith("-")) return false;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}

async function cloneRepo(
  owner: string,
  repo: string,
  ref: string,
  timeoutSeconds: number,
): Promise<string | null> {
  if (!isValidRef(ref)) return null;

  const cacheKey = `${owner}/${repo}@${ref}`;

  const existing = cloneRegistry.get(cacheKey);
  if (existing && fs.existsSync(existing)) return existing;

  const cloneDir = nodePath.join(CACHE_BASE, owner, `${repo}@${ref}`);

  if (fs.existsSync(cloneDir)) {
    cloneRegistry.set(cacheKey, cloneDir);
    return cloneDir;
  }

  fs.mkdirSync(nodePath.dirname(cloneDir), { recursive: true });

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const args = [
    "clone",
    "--depth=1",
    "--filter=blob:none",
    "--single-branch",
    `--branch=${ref}`,
    cloneUrl,
    cloneDir,
  ];

  try {
    await execFileAsync("git", args, { timeout: timeoutSeconds * 1000 });
    cloneRegistry.set(cacheKey, cloneDir);
    return cloneDir;
  } catch {
    fs.rmSync(cloneDir, { recursive: true, force: true });
    return null;
  }
}

function hasReadme(dir: string): boolean {
  return README_NAMES.some((name) => fs.existsSync(nodePath.join(dir, name)));
}

/**
 * Tier 2: Shallow-clone the repo and read from the local filesystem.
 * Session-scoped cache: clones persist for process lifetime.
 * Returns null if cloning fails, repo is too large, or URL type is unsupported.
 */
export async function fetchViaClone(
  parsed: GitHubUrl,
  signal?: AbortSignal,
  config?: GitHubConfig,
): Promise<ExtractedContent | null> {
  if (parsed.type === "unknown") return null;

  const cfg = config ?? DEFAULT_GITHUB_CONFIG;
  const ref = parsed.ref ?? "HEAD";
  const originalUrl = buildOriginalUrl(parsed);

  const sizeMB = await getRepoSizeMB(parsed.owner, parsed.repo, signal);
  if (sizeMB !== null && sizeMB > cfg.maxRepoSizeMB) return null;

  const cloneDir = await cloneRepo(parsed.owner, parsed.repo, ref, cfg.cloneTimeoutSeconds);
  if (!cloneDir) return null;

  if (parsed.type === "blob" || parsed.type === "raw") {
    if (!parsed.path) return null;

    const content = readCloneFile(cloneDir, parsed.path);
    if (content.startsWith("File not found:")) return null;
    const isBinary = content.startsWith("Binary file:");
    return {
      text: content,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url: originalUrl,
      extractionChain: ["github:clone"],
      chars: isBinary ? 0 : content.length,
      truncated: content.includes("[truncated]"),
    };
  }

  const isRoot = parsed.type === "root";
  const targetDir = parsed.path ? nodePath.join(cloneDir, parsed.path) : cloneDir;

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return null;
  }

  const listing = listCloneDir(
    targetDir,
    parsed.owner,
    parsed.repo,
    ref,
    isRoot || hasReadme(targetDir),
  );

  return {
    text: listing,
    title: `${parsed.owner}/${parsed.repo}${parsed.path ? ` - ${parsed.path}` : ""}`,
    url: originalUrl,
    extractionChain: ["github:clone"],
    chars: listing.length,
    truncated: false,
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Main GitHub content extraction orchestrator.
 * Tries three tiers in order: raw rewrite -> clone cache -> API fallback.
 * Returns null if the URL type is "unknown" or all tiers fail,
 * letting the main extraction pipeline handle it.
 */
export async function extractGitHub(
  parsed: GitHubUrl,
  signal?: AbortSignal,
  config?: GitHubConfig,
): Promise<ExtractedContent | null> {
  if (parsed.type === "unknown") return null;

  // Tier 1: Raw URL rewrite (blob and raw URLs only)
  if (parsed.type === "blob" || parsed.type === "raw") {
    const rawResult = await fetchRaw(parsed, signal);
    if (rawResult) return rawResult;
  }

  // Tier 2: Clone cache (all content URL types)
  const cloneResult = await fetchViaClone(parsed, signal, config);
  if (cloneResult) return cloneResult;

  // Tier 3: API fallback
  const apiResult = await fetchViaApi(parsed, signal);
  if (apiResult) return apiResult;

  return null;
}
