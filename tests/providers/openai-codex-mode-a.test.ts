// tests/providers/openai-codex-mode-a.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests Mode A (Codex streaming) by mocking the dynamic Pi package imports.
 * Uses vi.doMock to control the dynamic import() behavior inside openai-codex.ts.
 */
describe("OpenAICodexProvider - Mode A (Codex)", () => {
  const mockStream = vi.fn();
  const mockGetModel = vi.fn();
  const mockGetApiKey = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockStream.mockReset();
    mockGetModel.mockReset();
    mockGetApiKey.mockReset();

    vi.doMock("@earendil-works/pi-ai", () => ({
      streamOpenAICodexResponses: mockStream,
      getModel: mockGetModel,
    }));
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      AuthStorage: {
        create: () => ({ getApiKey: mockGetApiKey }),
      },
    }));

    mockGetModel.mockReturnValue({ id: "gpt-5.4-mini", provider: "openai-codex" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Mode A when Pi packages available and key resolves", async () => {
    mockGetApiKey.mockResolvedValue("pi-auth-key-123"); // resolveMode + searchModeA
    mockStream.mockReturnValue({
      result: () => Promise.resolve({
        stopReason: "end_turn",
        content: [
          {
            type: "toolCall",
            name: "submit_search_results",
            arguments: {
              results: [
                { title: "Codex Result", url: "https://codex-result.com", snippet: "Rich snippet about the topic." },
              ],
            },
          },
        ],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("codex query", 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Codex Result",
      url: "https://codex-result.com/",
      snippet: "Rich snippet about the topic.",
    });

    expect(mockStream).toHaveBeenCalledWith(
      { id: "gpt-5.4-mini", provider: "openai-codex" },
      expect.objectContaining({
        systemPrompt: expect.stringContaining("submit_search_results"),
        messages: [expect.objectContaining({ role: "user", content: "codex query" })],
        tools: [expect.objectContaining({ name: "submit_search_results" })],
      }),
      expect.objectContaining({
        apiKey: "pi-auth-key-123",
        transport: "sse",
        reasoningEffort: "minimal",
        textVerbosity: "low",
        onPayload: expect.any(Function),
      }),
    );
  });

  it("returns empty when stream returns error stopReason", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockStream.mockReturnValue({
      result: () => Promise.resolve({
        stopReason: "error",
        errorMessage: "Rate limit exceeded",
        content: [],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
  });

  it("returns empty when model is not found", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockGetModel.mockReturnValue(undefined);

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("uses configured model for Mode A", async () => {
    mockGetApiKey.mockResolvedValue("pi-key"); // resolveMode + searchModeA
    mockStream.mockReturnValue({
      result: () => Promise.resolve({ stopReason: "end_turn", content: [] }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined, { enabled: true, model: "gpt-5.4" } as any).search!;
    await provider.search("test", 5);

    expect(mockGetModel).toHaveBeenCalledWith("openai-codex", "gpt-5.4");
  });

  it("passes AbortSignal through to stream options", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockStream.mockReturnValue({
      result: () => Promise.resolve({ stopReason: "end_turn", content: [] }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const controller = new AbortController();
    await provider.search("test", 5, controller.signal);

    expect(mockStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("falls back to Mode B when key expires mid-session", async () => {
    // resolveMode calls getApiKey once, searchModeA calls it again each time
    mockGetApiKey
      .mockResolvedValueOnce("pi-key")   // resolveMode: key found → mode = codex
      .mockResolvedValueOnce("pi-key")   // first searchModeA: key still valid
      .mockResolvedValueOnce(undefined); // second searchModeA: key expired

    mockStream.mockReturnValueOnce({
      result: () => Promise.resolve({
        stopReason: "end_turn",
        content: [{
          type: "toolCall", name: "submit_search_results",
          arguments: { results: [{ title: "First", url: "https://first.com", snippet: "First." }] },
        }],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("backup-key").search!;

    // First search uses Mode A
    const first = await provider.search("first", 5);
    expect(first).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(1);

    // Second call: key expired → falls back to Mode B
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output: [{
          type: "message", role: "assistant",
          content: [{
            type: "output_text", text: "fallback",
            annotations: [{ type: "url_citation", url: "https://fallback.com", title: "Fallback" }],
          }],
        }],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const second = await provider.search("second", 5);
      expect(second).toHaveLength(1);
      expect(second[0].url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
