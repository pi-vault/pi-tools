import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import { createMockPi, makeCtx } from "./helpers.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });

  it("registers web_read tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_read")).toBe(true);
  });

  it("restores content from session on session_start", async () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("session_start")?.[0];
    expect(handler).toBeDefined();

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
              id: "wc-restored-1",
              url: "https://example.com",
              title: "Example",
              text: "Restored content",
              chars: 16,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: partial mock for test
      } as any,
    });

    handler?.({ type: "session_start", reason: "resume" }, ctx);

    // Verify restore worked by using web_read tool to retrieve the content
    const webRead = pi.tools.find((t) => t.name === "web_read");
    expect(webRead).toBeDefined();
    const result = await webRead?.execute("call-1", { contentId: "wc-restored-1" }, undefined, undefined, ctx);
    const text = (result?.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Restored content");
  });

  it("skips invalid entries during session restore", async () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("session_start")?.[0];
    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          // Valid entry
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: {
              id: "wc-valid",
              url: "https://example.com",
              title: "Valid",
              text: "Valid content",
              chars: 13,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
          // Corrupt entry: missing required fields
          {
            type: "custom",
            id: "e2",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: { id: "wc-corrupt", garbage: true },
          },
          // Non-matching custom entry
          {
            type: "custom",
            id: "e3",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "other-extension",
            data: { foo: "bar" },
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: partial mock for test
      } as any,
    });

    // Should not throw despite corrupt data
    expect(() => handler?.({ type: "session_start", reason: "resume" }, ctx)).not.toThrow();

    // Valid entry should be accessible
    const webRead = pi.tools.find((t) => t.name === "web_read");
    const validResult = await webRead?.execute("r1", { contentId: "wc-valid" }, undefined, undefined, ctx);
    const validText = (validResult?.content[0] as { type: "text"; text: string }).text;
    expect(validText).toContain("Valid content");

    // Corrupt entry should NOT be accessible (filtered out by validation)
    const corruptResult = await webRead?.execute("r2", { contentId: "wc-corrupt" }, undefined, undefined, ctx);
    const corruptText = (corruptResult?.content[0] as { type: "text"; text: string }).text;
    expect(corruptText.toLowerCase()).toContain("not found");
  });
});
