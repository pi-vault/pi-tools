// tests/providers/openai-native-rewrite.test.ts
import { describe, expect, it } from "vitest";
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "../../src/providers/openai-native-rewrite.ts";

describe("isOpenAiNativeModel", () => {
  it("returns true for 'openai' provider", () => {
    expect(isOpenAiNativeModel({ provider: "openai" })).toBe(true);
  });

  it("returns true for 'openai-codex' provider", () => {
    expect(isOpenAiNativeModel({ provider: "openai-codex" })).toBe(true);
  });

  it("returns true for providers starting with 'openai-'", () => {
    expect(isOpenAiNativeModel({ provider: "openai-gpt4" })).toBe(true);
  });

  it("returns false for 'anthropic' provider", () => {
    expect(isOpenAiNativeModel({ provider: "anthropic" })).toBe(false);
  });

  it("returns false for undefined model", () => {
    expect(isOpenAiNativeModel(undefined)).toBe(false);
  });

  it("returns false for model without provider", () => {
    expect(isOpenAiNativeModel({})).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOpenAiNativeModel({ provider: "OpenAI" })).toBe(true);
    expect(isOpenAiNativeModel({ provider: "OPENAI-CODEX" })).toBe(true);
  });
});

describe("rewriteNativeWebSearch", () => {
  it("rewrites web_search function tool to native format", () => {
    const payload = {
      model: "gpt-4.1",
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search the web", parameters: {} },
        },
      ],
      messages: [{ role: "user", content: "hello" }],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toEqual([
      { type: "web_search", external_web_access: true },
    ]);
    // Messages are preserved
    expect(result.payload.messages).toEqual(payload.messages);
  });

  it("preserves non-web_search tools", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
        {
          type: "function",
          function: { name: "web_fetch", description: "Fetch", parameters: {} },
        },
        {
          type: "function",
          function: { name: "code_search", description: "Code", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toHaveLength(3);
    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
    // Other tools preserved as-is
    expect(result.payload.tools[1]).toEqual(payload.tools[1]);
    expect(result.payload.tools[2]).toEqual(payload.tools[2]);
  });

  it("returns empty rewritten array when no web_search tools found", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_fetch", description: "Fetch", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual([]);
    expect(result.payload.tools).toEqual(payload.tools);
  });

  it("handles payload without tools array", () => {
    const payload = { model: "gpt-4.1", messages: [] };

    const result = rewriteNativeWebSearch(payload as any);

    expect(result.rewritten).toEqual([]);
    expect(result.payload).toEqual(payload);
  });

  it("respects externalWebAccess option", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload, {
      externalWebAccess: false,
    });

    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: false,
    });
  });

  it("defaults externalWebAccess to true", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
  });

  it("handles null or non-object entries in tools array", () => {
    const payload = {
      tools: [null, undefined, 42, { type: "function", function: { name: "web_search" } }],
    };

    const result = rewriteNativeWebSearch(payload as any);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toHaveLength(4);
    expect(result.payload.tools[0]).toBeNull();
    expect(result.payload.tools[1]).toBeUndefined();
    expect(result.payload.tools[2]).toBe(42);
    expect(result.payload.tools[3]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
  });

  it("rewrites each web_search tool independently", () => {
    const payload = {
      tools: [
        { type: "function", function: { name: "web_search" } },
        { type: "function", function: { name: "other_tool" } },
        { type: "function", function: { name: "web_search" } },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    // Both web_search tools are rewritten; "web_search" appears once per rewrite
    expect(result.rewritten).toEqual(["web_search", "web_search"]);
    expect(result.payload.tools).toHaveLength(3);
    expect(result.payload.tools[0]).toEqual({ type: "web_search", external_web_access: true });
    expect(result.payload.tools[1]).toEqual(payload.tools[1]);
    expect(result.payload.tools[2]).toEqual({ type: "web_search", external_web_access: true });
  });

  it("handles non-function tools gracefully", () => {
    const payload = {
      tools: [
        { type: "code_interpreter" },
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toHaveLength(2);
    expect(result.payload.tools[0]).toEqual({ type: "code_interpreter" });
    expect(result.payload.tools[1]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
  });
});
