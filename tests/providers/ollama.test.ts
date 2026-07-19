// tests/providers/ollama.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OllamaProvider,
  isLocalHost,
  isConnectionRefused,
  providerMeta,
} from "../../src/providers/ollama.ts";
import { stubFetch } from "../helpers.ts";

describe("isLocalHost", () => {
  it("returns true for localhost", () => {
    expect(isLocalHost("http://localhost:11434")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLocalHost("http://127.0.0.1:11434")).toBe(true);
  });

  it("returns true for 0.0.0.0", () => {
    expect(isLocalHost("http://0.0.0.0:11434")).toBe(true);
  });

  it("returns true for [::1]", () => {
    expect(isLocalHost("http://[::1]:11434")).toBe(true);
  });

  it("returns false for ollama.com", () => {
    expect(isLocalHost("https://ollama.com")).toBe(false);
  });

  it("returns false for custom hostname", () => {
    expect(isLocalHost("http://my-ollama.internal:11434")).toBe(false);
  });
});

describe("isConnectionRefused", () => {
  it("returns true for TypeError with ECONNREFUSED cause", () => {
    const err = new TypeError("fetch failed");
    (err as any).cause = { code: "ECONNREFUSED" };
    expect(isConnectionRefused(err)).toBe(true);
  });

  it("returns false for TypeError without cause", () => {
    expect(isConnectionRefused(new TypeError("fetch failed"))).toBe(false);
  });

  it("returns false for non-TypeError", () => {
    const err = new Error("fetch failed");
    (err as any).cause = { code: "ECONNREFUSED" };
    expect(isConnectionRefused(err)).toBe(false);
  });

  it("returns false for TypeError with different cause code", () => {
    const err = new TypeError("fetch failed");
    (err as any).cause = { code: "ETIMEDOUT" };
    expect(isConnectionRefused(err)).toBe(false);
  });
});

describe("OllamaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe("ollama");
    expect(provider.label).toBe("Ollama");
  });

  describe("search", () => {
    it("uses experimental paths for localhost", async () => {
      fetchStub.addResponse("localhost:11434/api/experimental/web_search", {
        body: {
          results: [{ title: "Result 1", url: "https://example.com", content: "A snippet" }],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        title: "Result 1",
        url: "https://example.com",
        snippet: "A snippet",
      });

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("http://localhost:11434/api/experimental/web_search");
    });

    it("uses stable paths for cloud host", async () => {
      fetchStub.addResponse("ollama.com/api/web_search", {
        body: {
          results: [
            { title: "Cloud Result", url: "https://example.com", content: "Cloud snippet" },
          ],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "https://ollama.com" });
      const results = await provider.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Cloud Result");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://ollama.com/api/web_search");
    });

    it("sends POST with query and max_results in body", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      await provider.search("my query", 10);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("my query");
      expect(body.max_results).toBe(10);
    });

    it("includes Authorization header when apiKey is set", async () => {
      fetchStub.addResponse("ollama.com", {
        body: { results: [] },
      });

      const provider = new OllamaProvider({
        baseUrl: "https://ollama.com",
        apiKey: "ollama-secret-key",
      });
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBe("Bearer ollama-secret-key");
    });

    it("does not include Authorization header without apiKey", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
    });

    it("limits results to maxResults", async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        content: `Snippet ${i}`,
      }));
      fetchStub.addResponse("localhost:11434", {
        body: { results: manyResults },
      });

      const provider = new OllamaProvider();
      const results = await provider.search("test", 3);
      expect(results).toHaveLength(3);
    });

    it("throws on HTTP error response", async () => {
      fetchStub.addResponse("localhost:11434", {
        status: 500,
        body: "Internal Server Error",
      });

      const provider = new OllamaProvider();
      await expect(provider.search("test", 5)).rejects.toThrow("Ollama API error");
    });

    it("throws actionable message on ECONNREFUSED", async () => {
      const originalFetch = globalThis.fetch;
      const err = new TypeError("fetch failed");
      (err as any).cause = { code: "ECONNREFUSED" };
      globalThis.fetch = (async () => {
        throw err;
      }) as any;

      try {
        const provider = new OllamaProvider();
        await expect(provider.search("test", 5)).rejects.toThrow(
          "Could not connect to Ollama at localhost:11434. Make sure Ollama is running (ollama serve).",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles empty results array", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      const results = await provider.search("nothing", 5);
      expect(results).toEqual([]);
    });
  });

  describe("fetch", () => {
    it("uses experimental paths for localhost", async () => {
      fetchStub.addResponse("localhost:11434/api/experimental/web_fetch", {
        body: {
          title: "Example Page",
          content: "Page content here",
          links: ["https://link1.com"],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
      const result = await provider.fetch("https://example.com");

      expect(result.title).toBe("Example Page");
      expect(result.text).toBe("Page content here");
      expect(result.contentType).toBe("text/html");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("http://localhost:11434/api/experimental/web_fetch");
    });

    it("uses stable paths for cloud host", async () => {
      fetchStub.addResponse("ollama.com/api/web_fetch", {
        body: {
          title: "Cloud Page",
          content: "Cloud content",
          links: [],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "https://ollama.com" });
      const result = await provider.fetch("https://example.com");

      expect(result.title).toBe("Cloud Page");
      expect(result.text).toBe("Cloud content");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://ollama.com/api/web_fetch");
    });

    it("sends POST with url in body", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { title: "T", content: "C", links: [] },
      });

      const provider = new OllamaProvider();
      await provider.fetch("https://example.com/page");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.url).toBe("https://example.com/page");
    });

    it("throws actionable message on ECONNREFUSED", async () => {
      const originalFetch = globalThis.fetch;
      const err = new TypeError("fetch failed");
      (err as any).cause = { code: "ECONNREFUSED" };
      globalThis.fetch = (async () => {
        throw err;
      }) as any;

      try {
        const provider = new OllamaProvider();
        await expect(provider.fetch("https://example.com")).rejects.toThrow(
          "Could not connect to Ollama at localhost:11434. Make sure Ollama is running (ollama serve).",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws on HTTP error response", async () => {
      fetchStub.addResponse("localhost:11434", {
        status: 404,
        body: "Not Found",
      });

      const provider = new OllamaProvider();
      await expect(provider.fetch("https://example.com")).rejects.toThrow("Ollama API error");
    });
  });
});

describe("providerMeta", () => {
  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("ollama");
    expect(providerMeta.tier).toBe(3);
    expect(providerMeta).not.toHaveProperty("monthlyQuota");
    expect(providerMeta.requiresKey).toBe(false);
  });

  it("returns empty object when not enabled and no env var", () => {
    const instance = providerMeta.create();
    expect(instance.search).toBeUndefined();
    expect(instance.fetch).toBeUndefined();
  });

  it("creates search and fetch providers when enabled", () => {
    const instance = providerMeta.create(undefined, {
      enabled: true,
      budget: { mode: "unlimited" },
      baseUrl: "http://localhost:11434",
    });
    expect(instance.search).toBeDefined();
    expect(instance.fetch).toBeDefined();
  });

  it("creates provider with custom baseUrl from config", () => {
    const instance = providerMeta.create(undefined, {
      enabled: true,
      budget: { mode: "unlimited" },
      baseUrl: "http://my-ollama:11434",
    });
    expect(instance.search).toBeDefined();
    expect(instance.fetch).toBeDefined();
  });

  it("registers when OLLAMA_HOST env var is set", () => {
    const original = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://custom-ollama:11434";
    try {
      const instance = providerMeta.create();
      expect(instance.search).toBeDefined();
      expect(instance.fetch).toBeDefined();
    } finally {
      if (original === undefined) {
        delete process.env.OLLAMA_HOST;
      } else {
        process.env.OLLAMA_HOST = original;
      }
    }
  });
});
