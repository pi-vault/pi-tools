import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStream = vi.fn();

const model = {
  id: "gpt-5.4",
  provider: "openai-codex",
  api: "openai-codex-responses",
} as Model<"openai-codex-responses">;

const successMessage = {
  stopReason: "end_turn",
  content: [
    {
      type: "toolCall",
      name: "submit_search_results",
      arguments: {
        results: [
          {
            title: "Codex Result",
            url: "https://example.com/result#source",
            snippet: "Useful source evidence.",
          },
        ],
      },
    },
  ],
};

function makeModelRegistry(
  overrides: Partial<{
    find: ReturnType<typeof vi.fn>;
    isUsingOAuth: ReturnType<typeof vi.fn>;
    getApiKeyAndHeaders: ReturnType<typeof vi.fn>;
  }> = {},
): ModelRegistry {
  return {
    find: vi.fn().mockReturnValue(model),
    isUsingOAuth: vi.fn().mockReturnValue(true),
    getApiKeyAndHeaders: vi.fn().mockResolvedValue({
      ok: true,
      apiKey: "oauth-token",
      headers: { "chatgpt-account-id": "acct" },
      env: { OPENAI_BASE_URL: "https://chatgpt.com/backend-api" },
    }),
    ...overrides,
  } as unknown as ModelRegistry;
}

async function makeProvider(modelRegistry?: ModelRegistry, configuredModel?: string) {
  const { providerMeta } = await import("../../src/providers/openai-codex.ts");
  const provider = providerMeta.create(
    undefined,
    configuredModel ? { enabled: true, model: configuredModel } : undefined,
    modelRegistry,
  ).search;
  if (!provider) throw new Error("OpenAI Codex search provider unavailable");
  return provider;
}

describe("OpenAICodexProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStream.mockReset().mockReturnValue({
      result: () => Promise.resolve(successMessage),
    });
    vi.doMock("@earendil-works/pi-ai", () => ({
      hasApi: (candidate: { api?: string }, api: string) => candidate.api === api,
    }));
    vi.doMock("@earendil-works/pi-ai/api/openai-codex-responses", () => ({
      stream: mockStream,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses fresh Pi OAuth credentials for every search", async () => {
    const modelRegistry = makeModelRegistry();
    const provider = await makeProvider(modelRegistry);
    const signal = new AbortController().signal;

    const first = await provider.search("codex query", 5, signal);
    await provider.search("second query", 5, signal);

    expect(first).toEqual([
      {
        title: "Codex Result",
        url: "https://example.com/result",
        snippet: "Useful source evidence.",
      },
    ]);
    expect(modelRegistry.find).toHaveBeenCalledWith("openai-codex", "gpt-5.4-mini");
    expect(modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledTimes(2);
    expect(mockStream).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: expect.stringContaining("submit_search_results"),
        messages: [expect.objectContaining({ role: "user", content: "codex query" })],
        tools: [expect.objectContaining({ name: "submit_search_results" })],
      }),
      {
        apiKey: "oauth-token",
        headers: { "chatgpt-account-id": "acct" },
        env: { OPENAI_BASE_URL: "https://chatgpt.com/backend-api" },
        signal,
        transport: "sse",
        reasoningEffort: "minimal",
        textVerbosity: "low",
        onPayload: expect.any(Function),
      },
    );
  });

  it("uses the configured model", async () => {
    const modelRegistry = makeModelRegistry();
    const provider = await makeProvider(modelRegistry, "gpt-5.4");

    await provider.search("query", 5);

    expect(modelRegistry.find).toHaveBeenCalledWith("openai-codex", "gpt-5.4");
  });

  it.each([
    {
      name: "a missing model registry",
      registry: undefined,
      message: "Pi model registry unavailable",
    },
    {
      name: "a missing model",
      registry: () => makeModelRegistry({ find: vi.fn().mockReturnValue(undefined) }),
      message: "OpenAI Codex model is unavailable",
    },
    {
      name: "a model using the wrong API",
      registry: () =>
        makeModelRegistry({
          find: vi.fn().mockReturnValue({ ...model, api: "openai-responses" }),
        }),
      message: "OpenAI Codex model is unavailable",
    },
    {
      name: "non-OAuth credentials",
      registry: () => makeModelRegistry({ isUsingOAuth: vi.fn().mockReturnValue(false) }),
      message: "OpenAI Codex requires Pi OAuth",
    },
    {
      name: "an auth resolution failure",
      registry: () =>
        makeModelRegistry({
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false, error: "expired" }),
        }),
      message: "OpenAI Codex auth failed: expired",
    },
    {
      name: "missing OAuth credentials",
      registry: () =>
        makeModelRegistry({
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true }),
        }),
      message: "OpenAI Codex OAuth credentials are unavailable",
    },
  ])("rejects $name", async ({ registry, message }) => {
    const provider = await makeProvider(typeof registry === "function" ? registry() : registry);

    await expect(provider.search("query", 5)).rejects.toThrow(message);
  });

  it.each([
    {
      name: "an error stream",
      message: { stopReason: "error", errorMessage: "rate limited", content: [] },
      error: "OpenAI Codex search failed: rate limited",
    },
    {
      name: "an aborted stream",
      message: { stopReason: "aborted", content: [] },
      error: "OpenAI Codex search aborted",
    },
    {
      name: "a response without the structured tool call",
      message: { stopReason: "end_turn", content: [] },
      error: "OpenAI Codex returned no structured search results",
    },
    {
      name: "a response without usable results",
      message: {
        stopReason: "end_turn",
        content: [
          {
            type: "toolCall",
            name: "submit_search_results",
            arguments: { results: [{ title: "Bad", url: "ftp://example.com", snippet: "" }] },
          },
        ],
      },
      error: "OpenAI Codex returned no usable search results",
    },
  ])("rejects $name", async ({ message, error }) => {
    mockStream.mockReturnValue({ result: () => Promise.resolve(message) });
    const provider = await makeProvider(makeModelRegistry());

    await expect(provider.search("query", 5)).rejects.toThrow(error);
  });

  it("rejects a pre-aborted search before resolving the model", async () => {
    const modelRegistry = makeModelRegistry();
    const provider = await makeProvider(modelRegistry);
    const controller = new AbortController();
    controller.abort();

    await expect(provider.search("query", 5, controller.signal)).rejects.toThrow();
    expect(modelRegistry.find).not.toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("does not require an API key in provider configuration", async () => {
    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    expect(providerMeta.requiresKey).toBe(false);
  });
});
