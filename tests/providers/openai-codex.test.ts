// tests/providers/openai-codex.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

/**
 * Tests for the OpenAI Codex provider, Mode B (Responses API) behavior.
 * Pi packages will fail to dynamically import in test env, so provider
 * falls back to Mode B when a user key is provided.
 */
describe("OpenAICodexProvider - Mode B (Responses API)", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    vi.resetModules();
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  it("has correct name and label", async () => {
    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("test-key").search!;
    expect(provider.name).toBe("openai-codex");
    expect(provider.label).toBe("OpenAI Codex");
  });

  it("extracts search results from url_citation annotations", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Results found",
                annotations: [
                  { type: "url_citation", url: "https://example.com", title: "Example" },
                  { type: "url_citation", url: "https://other.com", title: "Other" },
                ],
              },
            ],
          },
        ],
      },
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("test-key").search!;
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Example", url: "https://example.com", snippet: "" });
    expect(results[1]).toEqual({ title: "Other", url: "https://other.com", snippet: "" });
  });

  it("sends correct Authorization header and request body", async () => {
    fetchStub.addResponse("api.openai.com", { body: { output: [] } });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("sk-my-key").search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer sk-my-key");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1-nano");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toBe("required");
    expect(body.input).toContain("test");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.openai.com", { status: 429, body: "Rate limited" });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("sk-key").search!;
    await expect(provider.search("test", 5)).rejects.toThrow("429");
  });

  it("respects maxResults limit", async () => {
    const annotations = Array.from({ length: 20 }, (_, i) => ({
      type: "url_citation", url: `https://site${i}.com`, title: `Site ${i}`,
    }));
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [{
          type: "message", role: "assistant",
          content: [{ type: "output_text", text: "text", annotations }],
        }],
      },
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("sk-key").search!;
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(5);
  });

  it("uses custom model from config", async () => {
    fetchStub.addResponse("api.openai.com", { body: { output: [] } });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("sk-key", { enabled: true, model: "gpt-4.1" } as any).search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1");
  });

  it("returns empty results when no key and no Pi packages", async () => {
    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
  });

  it("provider meta has requiresKey: false and tier 1", async () => {
    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    expect(providerMeta.requiresKey).toBe(false);
    expect(providerMeta.name).toBe("openai-codex");
    expect(providerMeta.tier).toBe(1);
  });
});
