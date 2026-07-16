import { describe, expect, it, vi } from "vitest";
import {
  handleProviderRequest,
  handleSessionStart,
} from "../src/session.ts";
import type { PiToolsConfig } from "../src/config.ts";
import { makeCtx } from "./helpers.ts";

describe("handleSessionStart", () => {
  it("restores content and calls refresh", () => {
    const store = { restore: vi.fn() };
    const refresh = vi.fn();

    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: {
              id: "wc-1",
              url: "https://example.com",
              text: "restored",
              chars: 8,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
        ],
      } as any,
    });

    handleSessionStart({ type: "session_start", reason: "resume" }, ctx, store as any, refresh);

    expect(store.restore).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("calls refresh even when no entries to restore", () => {
    const store = { restore: vi.fn() };
    const refresh = vi.fn();
    const ctx = makeCtx();

    handleSessionStart({ type: "session_start", reason: "startup" }, ctx, store as any, refresh);

    expect(store.restore).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips corrupt entries during restore", () => {
    const store = { restore: vi.fn() };
    const refresh = vi.fn();
    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: { id: "wc-corrupt", garbage: true },
          },
        ],
      } as any,
    });

    handleSessionStart({ type: "session_start", reason: "resume" }, ctx, store as any, refresh);

    expect(store.restore).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("handleProviderRequest", () => {
  const baseConfig: PiToolsConfig = {
    defaultProvider: "duckduckgo",
    selectionStrategy: "auto",
    providers: {},
    github: { enabled: false, maxRepoSizeMB: 100, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 10 },
    deepResearch: { enabled: false },
  };

  it("rewrites web_search to native format for OpenAI models", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
      messages: [{ role: "user", content: "hello" }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    ) as typeof payload;

    expect(result?.tools?.[0]).toEqual({ type: "web_search", external_web_access: true });
    expect(result?.messages).toEqual(payload.messages);
  });

  it("returns undefined for non-OpenAI models", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "anthropic" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    );

    expect(result).toBeUndefined();
  });

  it("returns undefined when openai-web-search is disabled", () => {
    const config: PiToolsConfig = {
      ...baseConfig,
      providers: { "openai-web-search": { enabled: false } },
    };
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => config,
    );

    expect(result).toBeUndefined();
  });

  it("returns undefined when no web_search tool in payload", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "other_tool", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    );

    expect(result).toBeUndefined();
  });
});


