import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockPi } from "./helpers.ts";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

describe("web_research registration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("registers web_research when exa API key is available", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).toContain("web_research");
  });

  it("does not register web_research when exa API key is missing", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "EXA_API_KEY" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    delete process.env.EXA_API_KEY;
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
  });

  it("does not register web_research when deepResearch.enabled is false", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: false },
    } as any);

    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
  });
});
