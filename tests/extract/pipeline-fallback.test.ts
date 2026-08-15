import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/extract/youtube.ts", () => ({
  isYouTubeURL: vi.fn(),
  extractYouTube: vi.fn(),
  isYouTubeEnabled: vi.fn(),
}));

vi.mock("../../src/extract/video.ts", () => ({
  isVideoFile: vi.fn(),
  extractVideo: vi.fn(),
  isVideoEnabled: vi.fn(),
}));

vi.mock("../../src/extract/frames.ts", () => ({
  parseTimestampParam: vi.fn(),
  extractYouTubeFrames: vi.fn(),
  extractLocalFrames: vi.fn(),
  getLocalVideoDuration: vi.fn(),
  getYouTubeStreamInfo: vi.fn(),
}));

vi.mock("../../src/extract/gemini-url-context.ts", () => ({
  extractWithUrlContext: vi.fn(),
  extractWithGeminiWeb: vi.fn(),
}));

import { extractContent, RetryableExtractionError } from "../../src/extract/pipeline.ts";
import { extractWithUrlContext, extractWithGeminiWeb } from "../../src/extract/gemini-url-context.ts";
import type { FetchProvider, FetchResult } from "../../src/providers/types.ts";
import type { ExecutionHooks } from "../../src/providers/execute.ts";
import { BudgetExceededError } from "../../src/providers/registry.ts";
import { isYouTubeURL, extractYouTube, isYouTubeEnabled } from "../../src/extract/youtube.ts";
import { isVideoFile, extractVideo, isVideoEnabled } from "../../src/extract/video.ts";

function provider(name: string, result: FetchResult | null | Error): FetchProvider {
  const fetchFn = vi.fn();
  if (result instanceof Error) {
    fetchFn.mockRejectedValue(result);
  } else {
    fetchFn.mockResolvedValue(result);
  }
  return { name, fetch: fetchFn };
}

const LONG_TEXT = "  Long content from the provider used by tests. ".repeat(10).trim();

describe("extractContent — registered fetch provider ordering", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
    vi.mocked(extractYouTube).mockResolvedValue(null);
    vi.mocked(extractVideo).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs Readability and RSC before registered providers, then Gemini last", async () => {
    const fetchProvider = provider("jina", { text: LONG_TEXT, title: "From Jina" });
    vi.mocked(extractWithUrlContext).mockResolvedValue({
      text: "Gemini content",
      url: "https://example.com/article",
      extractionChain: ["html:gemini-url-context"],
      chars: 14,
      truncated: false,
    });

    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("<html><body><p>short body</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/article", undefined, {
        fetchProviders: [fetchProvider],
      });
      expect(result.extractionChain).toEqual([
        "http:200",
        "readability:thin",
        "rsc:no-match",
        "fetch-provider:jina",
      ]);
      expect(result.title).toBe("From Jina");
      expect(extractWithUrlContext).not.toHaveBeenCalled();
      expect(extractWithGeminiWeb).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("uses Gemini when no fetch providers are supplied", async () => {
    vi.mocked(extractWithUrlContext).mockResolvedValue({
      text: "Gemini only content",
      url: "https://example.com/article",
      extractionChain: ["html:gemini-url-context"],
      chars: 18,
      truncated: false,
    });

    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("<html><body><p>short body</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/article", undefined);
      expect(result.extractionChain).toEqual([
        "http:200",
        "readability:thin",
        "rsc:no-match",
        "fetch-provider:skipped",
        "html:gemini-url-context",
      ]);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("records fetch-provider:error when all providers fail", async () => {
    const a = provider("a", new Error("a-bad"));
    const b = provider("b", new Error("b-bad"));

    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("<html><body><p>short body</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/article", undefined, {
        fetchProviders: [a, b],
      });
      expect(result.extractionChain).toContain("fetch-provider:error");
      expect(result.extractionChain).toContain("gemini-html:fail");
      expect(result.extractionChain).toContain("raw-text");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("extractContent — retryable transport fallback", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("recovers from 5xx through a registered provider", async () => {
    const providerA: FetchProvider = {
      name: "jina",
      fetch: vi.fn(async () => ({ text: LONG_TEXT, title: "Jina" })),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        // HEAD probe succeeds so the pipeline doesn't bail out
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Server Error", { status: 503, headers: {} });
    }) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/broken", undefined, {
        fetchProviders: [providerA],
      });
      expect(result.extractionChain).toEqual(["fetch-provider:jina"]);
      expect(providerA.fetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("throws RetryableExtractionError when no provider recovers", async () => {
    const providerA: FetchProvider = {
      name: "exa",
      fetch: vi.fn(async () => {
        throw new Error("exa-down");
      }),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Server Error", { status: 502, headers: {} });
    }) as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/broken", undefined, {
          fetchProviders: [providerA],
        }),
      ).rejects.toThrow(RetryableExtractionError);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not invoke the Gemini adapters when transport fails", async () => {
    const providerA: FetchProvider = {
      name: "jina",
      fetch: vi.fn(async () => {
        throw new Error("jina-down");
      }),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Server Error", { status: 503, headers: {} });
    }) as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/broken", undefined, {
          fetchProviders: [providerA],
        }),
      ).rejects.toThrow(RetryableExtractionError);
      expect(extractWithUrlContext).not.toHaveBeenCalled();
      expect(extractWithGeminiWeb).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not record budget rejection as a provider failure hook", async () => {
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const hooks: ExecutionHooks = { onFailure, onSuccess };
    const a: FetchProvider = {
      name: "exhausted",
      fetch: vi.fn(async () => {
        throw new BudgetExceededError("exhausted", 1, {
          mode: "hard",
          used: 1,
          limit: 1,
          unit: "request",
          period: "month",
          periodKey: "2026-08",
        });
      }),
    };
    const b: FetchProvider = {
      name: "ok",
      fetch: vi.fn(async () => ({ text: LONG_TEXT })),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Server Error", { status: 503, headers: {} });
    }) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/broken", undefined, {
        fetchProviders: [a, b],
        executionHooks: hooks,
      });
      expect(result.extractionChain).toContain("fetch-provider:ok");
      expect(onFailure).not.toHaveBeenCalledWith("exhausted");
      expect(onSuccess).toHaveBeenCalledWith("ok", expect.any(Number));
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("extractContent — provider isolation from structured routes", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not invoke fetch providers for an invalid SSRF URL", async () => {
    const providerA: FetchProvider = {
      name: "jina",
      fetch: vi.fn(async () => ({ text: LONG_TEXT })),
    };
    await expect(
      extractContent("http://127.0.0.1/page", undefined, { fetchProviders: [providerA] }),
    ).rejects.toThrow();
    expect(providerA.fetch).not.toHaveBeenCalled();
  });

  it("does not invoke fetch providers in raw mode on a successful GET", async () => {
    const providerA: FetchProvider = {
      name: "jina",
      fetch: vi.fn(async () => ({ text: LONG_TEXT })),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("raw body", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    try {
      const result = await extractContent("https://example.com/page", undefined, {
        raw: true,
        fetchProviders: [providerA],
      });
      expect(result.extractionChain).toContain("raw");
      expect(providerA.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not invoke fetch providers for binary content type", async () => {
    const providerA: FetchProvider = {
      name: "jina",
      fetch: vi.fn(async () => ({ text: LONG_TEXT })),
    };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("img-bytes", { status: 200, headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/photo.png", undefined, {
          fetchProviders: [providerA],
        }),
      ).rejects.toThrow(/binary/i);
      expect(providerA.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("extractContent — caller cancellation propagation", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with the caller's abort when cancelled before pipeline entry", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractContent("https://example.com/article", controller.signal),
    ).rejects.toThrow();
  });

  it("stops after an aborted HEAD probe instead of continuing to GET", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const orig = globalThis.fetch;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        controller.abort(reason);
        throw reason;
      }
      return new Response("GET should not run", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/article", controller.signal),
      ).rejects.toBe(reason);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("stops later providers when aborted during provider fallback", async () => {
    const controller = new AbortController();
    const abortingProvider: FetchProvider = {
      name: "first",
      fetch: vi.fn(async () => {
        controller.abort();
        return { text: LONG_TEXT };
      }),
    };
    const laterProvider: FetchProvider = {
      name: "second",
      fetch: vi.fn(async () => ({ text: LONG_TEXT })),
    };

    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("Server Error", { status: 503, headers: {} });
    }) as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/article", controller.signal, {
          fetchProviders: [abortingProvider, laterProvider],
        }),
      ).rejects.toThrow();
      expect(laterProvider.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not call Gemini Web after URL context observes cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    vi.mocked(extractWithUrlContext).mockImplementation(async () => {
      controller.abort(reason);
      return null;
    });
    vi.mocked(extractWithGeminiWeb).mockResolvedValue({
      text: "Gemini content",
      url: "https://example.com/article",
      extractionChain: ["html:gemini-web"],
      chars: 15,
      truncated: false,
    });

    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response("<html><body>thin</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    try {
      await expect(
        extractContent("https://example.com/article", controller.signal),
      ).rejects.toBe(reason);
      expect(extractWithGeminiWeb).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
