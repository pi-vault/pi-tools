import { describe, expect, it, vi, beforeEach } from "vitest";
import createExtension from "../src/index.ts";
import { loadMergedConfig } from "../src/config.ts";
import { createMockPi, makeCtx } from "./helpers.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";

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
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) => fn(),
  };
});

// biome-ignore lint/suspicious/noExplicitAny: partial mock config
function mockConfig(overrides: Record<string, unknown> = {}) {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers: {
      exa: {
        enabled: true,
        apiKey: "test-key",
        budget: { mode: "hard", limit: 10, period: "month", unit: "usd", pool: "exa" },
      },
    },
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
    ...overrides,
  } as any;
}

function registeredToolNames() {
  const pi = createMockPi();
  // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
  createExtension(pi as any);
  pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, makeCtx());
  return pi.tools.map((t) => t.name);
}

describe("web_research registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers web_research when exa API key is available", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(mockConfig());
    expect(registeredToolNames()).toContain("web_research");
  });

  it("does not register web_research when exa API key is missing", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      mockConfig({ providers: { exa: { enabled: true, apiKey: "EXA_API_KEY" } } }),
    );
    delete process.env.EXA_API_KEY;
    expect(registeredToolNames()).not.toContain("web_research");
  });

  it("does not register web_research when deepResearch.enabled is false", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(mockConfig({ deepResearch: { enabled: false } }));
    expect(registeredToolNames()).not.toContain("web_research");
  });

  it("does not register web_research when Exa is disabled", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      mockConfig({
        providers: {
          exa: {
            enabled: false,
            apiKey: "test-key",
            budget: { mode: "hard", limit: 10, period: "month", unit: "usd" },
          },
        },
      }),
    );
    expect(registeredToolNames()).not.toContain("web_research");
  });

  it("passes research operation metadata to the registry", async () => {
    vi.mocked(loadMergedConfig).mockReturnValue(mockConfig());
    const consume = vi.spyOn(ProviderRegistry.prototype, "consume");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [], answer: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const tool = pi.tools.find((candidate) => candidate.name === "web_research")!;
    await tool.execute(
      "call",
      { query: "test", type: "deep-lite", numResults: 5, summaryQuery: "summary" },
      undefined,
      vi.fn(),
      ctx,
    );

    expect(consume).toHaveBeenCalledWith("exa", {
      capability: "research",
      type: "deep-lite",
      maxResults: 5,
      contentTypes: 3,
    });
  });
});
