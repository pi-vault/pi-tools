import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFetchProviderFallback,
  runExtractionFallbacks,
  type ExtractionFallback,
} from "../../src/extract/fallbacks.ts";
import type { FetchProvider, FetchResult } from "../../src/providers/types.ts";
import type { ExecutionHooks } from "../../src/providers/execute.ts";
import { BudgetExceededError } from "../../src/providers/registry.ts";

const LONG_TEXT = "  Fetched content from the provider. ".repeat(10).trim();

function makeProvider(name: string, fetch: FetchProvider["fetch"]): FetchProvider {
  return { name, fetch };
}

function ok(text: string, title?: string): FetchResult {
  return { text, title };
}

describe("createFetchProviderFallback", () => {
  it("returns null without invoking when providers list is empty", async () => {
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [],
    });
    expect(await fallback.run()).toBeNull();
  });

  it("calls providers in supplied order through executeWithFallback", async () => {
    const calls: string[] = [];
    const a = makeProvider("a", vi.fn(async () => {
      calls.push("a");
      throw new Error("fail-a");
    }));
    const b = makeProvider("b", vi.fn(async () => {
      calls.push("b");
      throw new Error("fail-b");
    }));
    const c = makeProvider("c", vi.fn(async () => {
      calls.push("c");
      return ok(LONG_TEXT, "Title from c");
    }));

    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [a, b, c],
    });
    const result = await fallback.run();

    expect(calls).toEqual(["a", "b", "c"]);
    expect(result).not.toBeNull();
    expect(result?.extractionChain).toEqual(["fetch-provider:c"]);
    expect(result?.title).toBe("Title from c");
    expect(result?.chars).toBe(LONG_TEXT.length);
  });

  it("normalizes the returned content with provider-only chain marker", async () => {
    const provider = makeProvider("jina", vi.fn(async () => ok(LONG_TEXT, "Readability title")));
    const fallback = createFetchProviderFallback({
      url: "https://example.com/article",
      providers: [provider],
    });

    const result = await fallback.run();
    expect(result).toEqual({
      text: LONG_TEXT,
      title: "Readability title",
      url: "https://example.com/article",
      extractionChain: ["fetch-provider:jina"],
      chars: LONG_TEXT.length,
      truncated: false,
    });
  });

  it("treats empty text as a failed attempt", async () => {
    const failing = makeProvider("a", vi.fn(async () => ({ text: "   \n  " })));
    const succeeding = makeProvider(
      "b",
      vi.fn(async () => ok(LONG_TEXT)),
    );
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [failing, succeeding],
    });

    const result = await fallback.run();
    expect(result?.extractionChain).toEqual(["fetch-provider:b"]);
  });

  it("trims the returned text before measuring chars", async () => {
    const provider = makeProvider(
      "trim",
      vi.fn(async () => ({ text: `   ${LONG_TEXT}   ` })),
    );
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [provider],
    });

    const result = await fallback.run();
    expect(result?.text).toBe(LONG_TEXT);
    expect(result?.chars).toBe(LONG_TEXT.length);
  });

  it("returns null when all providers fail", async () => {
    const failing = makeProvider("nope", vi.fn(async () => {
      throw new Error("kaboom");
    }));
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [failing],
    });

    expect(await fallback.run()).toBeNull();
  });

  it("passes signal through to providers", async () => {
    const seenSignals: Array<AbortSignal | undefined> = [];
    const provider: FetchProvider = {
      name: "spy",
      fetch: vi.fn(async (_url, signal) => {
        seenSignals.push(signal);
        return ok(LONG_TEXT);
      }),
    };
    const controller = new AbortController();
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [provider],
      signal: controller.signal,
    });

    await fallback.run();
    expect(seenSignals).toEqual([controller.signal]);
  });

  it("passes hooks through to executeWithFallback", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const hooks: ExecutionHooks = { onSuccess, onFailure };

    const a = makeProvider("a", vi.fn(async () => {
      throw new Error("a-bad");
    }));
    const b = makeProvider("b", vi.fn(async () => ok(LONG_TEXT)));
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [a, b],
      hooks,
    });

    await fallback.run();

    expect(onFailure).toHaveBeenCalledWith("a");
    expect(onFailure).not.toHaveBeenCalledWith("b");
    expect(onSuccess).toHaveBeenCalledWith("b", expect.any(Number));
  });

  it("does not record BudgetExceededError as a performance failure", async () => {
    const onFailure = vi.fn();
    const exhausted = makeProvider("budget", vi.fn(async () => {
      throw new BudgetExceededError("budget", 1, {
        mode: "hard",
        used: 1,
        limit: 1,
        unit: "request",
        period: "month",
        periodKey: "2026-08",
      });
    }));
    const working = makeProvider("ok", vi.fn(async () => ok(LONG_TEXT)));
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [exhausted, working],
      hooks: { onFailure },
    });

    const result = await fallback.run();
    expect(result?.extractionChain).toEqual(["fetch-provider:ok"]);
    expect(onFailure).not.toHaveBeenCalledWith("budget");
  });

  it("rethrows caller cancellation that arrives mid-run", async () => {
    const controller = new AbortController();
    const provider: FetchProvider = {
      name: "aborting",
      fetch: vi.fn(async () => {
        controller.abort();
        return ok(LONG_TEXT);
      }),
    };
    const fallback = createFetchProviderFallback({
      url: "https://example.com",
      providers: [provider],
      signal: controller.signal,
    });

    await expect(fallback.run()).rejects.toThrow();
  });
});

describe("runExtractionFallbacks", () => {
  let fallback1Run = vi.fn();
  let fallback2Run = vi.fn();
  let chain: string[];

  beforeEach(() => {
    fallback1Run = vi.fn();
    fallback2Run = vi.fn();
    chain = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first non-null result and appends its chain marker", async () => {
    const fallbackA: ExtractionFallback = {
      name: "a",
      run: fallback1Run.mockResolvedValue(null),
    };
    const fallbackB: ExtractionFallback = {
      name: "b",
      run: fallback2Run.mockResolvedValue({
        text: "Body",
        url: "https://example.com",
        extractionChain: ["html:gemini-url-context"],
        chars: 4,
        truncated: false,
      }),
    };

    const result = await runExtractionFallbacks([fallbackA, fallbackB], chain);
    expect(result?.text).toBe("Body");
    expect(chain).toEqual(["a:fail", "html:gemini-url-context"]);
  });

  it("records fail markers when a fallback returns null", async () => {
    const fallbackA: ExtractionFallback = {
      name: "a",
      run: vi.fn(async () => null),
    };
    const fallbackB: ExtractionFallback = {
      name: "b",
      run: vi.fn(async () => null),
    };

    const result = await runExtractionFallbacks([fallbackA, fallbackB], chain);
    expect(result).toBeNull();
    expect(chain).toEqual(["a:fail", "b:fail"]);
  });

  it("records error markers when a fallback throws non-abort errors", async () => {
    const fallbackA: ExtractionFallback = {
      name: "a",
      run: vi.fn(async () => {
        throw new Error("hard-fail");
      }),
    };
    const fallbackB: ExtractionFallback = {
      name: "b",
      run: vi.fn(async () => null),
    };

    const result = await runExtractionFallbacks([fallbackA, fallbackB], chain);
    expect(result).toBeNull();
    expect(chain).toEqual(["a:error", "b:fail"]);
  });

  it("stops the chain when caller cancellation is observed before next adapter", async () => {
    const controller = new AbortController();
    controller.abort();

    const seen: string[] = [];
    const fallbackA: ExtractionFallback = {
      name: "a",
      run: vi.fn(async () => {
        seen.push("a");
        return null;
      }),
    };
    const fallbackB: ExtractionFallback = {
      name: "b",
      run: vi.fn(async () => {
        seen.push("b");
        return null;
      }),
    };

    await expect(
      runExtractionFallbacks([fallbackA, fallbackB], chain, controller.signal),
    ).rejects.toThrow();
    // First check throws before invoking A, so neither runs.
    expect(seen).toEqual([]);
  });

  it("returns null when no fallbacks are supplied", async () => {
    expect(await runExtractionFallbacks([], chain)).toBeNull();
    expect(chain).toEqual([]);
  });

  it("appends the first marker of the winning fallback only", async () => {
    const winning: ExtractionFallback = {
      name: "win",
      run: vi.fn(async () => ({
        text: "Body",
        url: "https://example.com",
        extractionChain: ["fetch-provider:jina"],
        chars: 4,
        truncated: false,
      })),
    };
    const resultChain: string[] = ["http:200"];
    const result = await runExtractionFallbacks(
      [
        { name: "lose", run: vi.fn(async () => null) },
        winning,
      ],
      resultChain,
    );
    expect(result?.extractionChain).toEqual(["fetch-provider:jina"]);
    expect(resultChain).toEqual(["http:200", "lose:fail", "fetch-provider:jina"]);
  });
});
