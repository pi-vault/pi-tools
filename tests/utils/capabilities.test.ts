import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectCapabilities,
  resetCapabilitiesCache,
  type EnvironmentCapabilities,
} from "../../src/utils/capabilities.ts";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

describe("detectCapabilities", () => {
  const mockSpawnSync = childProcess.spawnSync as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    resetCapabilitiesCache();
  });

  it("detects all tools when available", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(true);
    expect(caps.hasFfmpeg).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
  });

  it("returns false for tools that throw or have non-zero status", () => {
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (cmd === "gh") return { status: 0 };
      return { status: 1 };
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("returns all false when no tools available", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(false);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("returns all false when spawnSync throws", () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(false);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("caches results after first call", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    detectCapabilities();
    detectCapabilities();

    // Only 3 calls (one per tool), not 6
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
  });
});
