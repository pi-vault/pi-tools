import { spawnSync } from "node:child_process";

export interface EnvironmentCapabilities {
  hasGhCli: boolean;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
}

function isToolAvailable(name: string): boolean {
  try {
    const result = spawnSync(name, ["--version"], {
      timeout: 2_000,
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

let cached: EnvironmentCapabilities | null = null;

export function detectCapabilities(): EnvironmentCapabilities {
  if (cached) return cached;
  cached = {
    hasGhCli: isToolAvailable("gh"),
    hasYtDlp: isToolAvailable("yt-dlp"),
    hasFfmpeg: isToolAvailable("ffmpeg"),
  };
  return cached;
}

/** @internal Reset cache for tests */
export function resetCapabilitiesCache(): void {
  cached = null;
}
