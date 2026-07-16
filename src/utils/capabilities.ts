import { spawnSync } from "node:child_process";
import type { GuidanceOverride } from "../config.ts";

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

export function buildAugmentedGuidance(
  base: GuidanceOverride | undefined,
  caps: EnvironmentCapabilities,
): GuidanceOverride {
  const extras: string[] = [];
  if (caps.hasGhCli) extras.push("For GitHub repository URLs, consider using the `gh` CLI directly for richer file access.");
  if (caps.hasYtDlp) extras.push("YouTube frame extraction is available (yt-dlp detected).");
  if (caps.hasFfmpeg) extras.push("Local video analysis with frame extraction is available (ffmpeg detected).");

  if (extras.length === 0) return base ?? {};

  return {
    ...base,
    promptGuidelines: [...(base?.promptGuidelines ?? []), ...extras],
  };
}
