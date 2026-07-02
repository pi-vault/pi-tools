import { execFile as defaultExecFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";
import { applyDomainFilters } from "../utils/filters.ts";

interface DDGSResult {
  title: string;
  href: string;
  body: string;
}

// Narrow type covering only the execFile overload we actually call.
// Using typeof defaultExecFile would require __promisify__, making mocks complex.
export type ExecFileFn = (
  command: string,
  args: string[],
  options: { timeout?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => { kill(): boolean | undefined };

const EXEC_TIMEOUT_MS = 15_000;

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  private readonly execFile: ExecFileFn;

  constructor(execFileFn: ExecFileFn = defaultExecFile as unknown as ExecFileFn) {
    this.execFile = execFileFn;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    if (signal?.aborted) {
      throw new Error("Search aborted");
    }

    const effectiveQuery = applyDomainFilters(query, filters);
    const timelimit = computeTimelimit(filters);

    const tmpFile = path.join(
      os.tmpdir(),
      `ddgs-${crypto.randomUUID()}.json`,
    );

    try {
      // runDdgs handles ENOENT (binary missing) and rethrows with install hint
      await this.runDdgs(effectiveQuery, maxResults, tmpFile, signal, timelimit);

      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, "utf-8");
      } catch {
        throw new Error("Failed to parse ddgs output: output file not created");
      }

      let data: DDGSResult[];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        data = parsed as DDGSResult[];
      } catch {
        throw new Error("Failed to parse ddgs output: malformed JSON");
      }

      return data.slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.href,
        snippet: r.body,
      }));
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private runDdgs(
    query: string,
    maxResults: number,
    outPath: string,
    signal?: AbortSignal,
    timelimit?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        child.kill();
        reject(new Error("Search aborted"));
      };

      const args = ["text", "-q", query, "-m", String(maxResults), "-o", outPath];
      if (timelimit) {
        args.push("-t", timelimit);
      }

      const child = this.execFile(
        "ddgs",
        args,
        { timeout: EXEC_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          if (error) {
            // ENOENT from execFile means the ddgs binary is missing
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              reject(
                new Error(
                  "ddgs CLI not found. Install with: pip install ddgs (or: uv tool install ddgs)",
                ),
              );
              return;
            }
            // Include stderr in the error message when available
            const detail = stderr?.trim();
            reject(detail ? new Error(`ddgs failed: ${detail}`) : error);
          } else {
            resolve();
          }
        },
      );

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

/**
 * Maps a startDate to the closest ddgs timelimit flag.
 * ddgs supports: d (day), w (week), m (month), y (year).
 * endDate is not supported — silently ignored.
 */
function computeTimelimit(filters?: SearchFilters): string | undefined {
  if (!filters?.startDate) return undefined;

  const start = new Date(filters.startDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return undefined; // future date — ignore
  if (diffDays <= 1) return "d";
  if (diffDays <= 7) return "w";
  if (diffDays <= 30) return "m";
  return "y";
}
