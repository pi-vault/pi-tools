import { execFile as defaultExecFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SearchProvider, SearchResult } from "./types.ts";

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
  ): Promise<SearchResult[]> {
    if (signal?.aborted) {
      throw new Error("Search aborted");
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `ddgs-${crypto.randomUUID()}.json`,
    );

    try {
      // runDdgs handles ENOENT (binary missing) and rethrows with install hint
      await this.runDdgs(query, maxResults, tmpFile, signal);

      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, "utf-8");
      } catch {
        throw new Error("Failed to parse ddgs output: output file not created");
      }

      const data: DDGSResult[] = JSON.parse(raw);
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
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.execFile(
        "ddgs",
        ["text", "-q", query, "-m", String(maxResults), "-o", outPath],
        { timeout: EXEC_TIMEOUT_MS },
        (error, _stdout, stderr) => {
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
        signal.addEventListener(
          "abort",
          () => {
            child.kill();
            reject(new Error("Search aborted"));
          },
          { once: true },
        );
      }
    });
  }
}
