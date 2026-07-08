import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Context7DocsProvider,
  Context7Error,
  providerMeta,
} from "../../src/providers/context7.ts";
import { stubFetch } from "../helpers.ts";

describe("Context7DocsProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new Context7DocsProvider("ctx7sk_test");
    expect(provider.name).toBe("context7");
    expect(provider.label).toBe("Context7");
  });

  describe("searchLibrary", () => {
    it("returns mapped search results", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: {
          results: [
            {
              id: "/facebook/react",
              title: "React",
              description: "A JavaScript library for building user interfaces",
              totalSnippets: 2500,
              trustScore: 10,
              benchmarkScore: 95.5,
              versions: ["v18.2.0", "v17.0.2"],
            },
          ],
          searchFilterApplied: false,
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const results = await provider.searchLibrary("react", "state management");

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("/facebook/react");
      expect(results[0].name).toBe("React");
      expect(results[0].trustScore).toBe(10);
      expect(results[0].versions).toEqual(["v18.2.0", "v17.0.2"]);
    });

    it("returns empty array when no results", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const results = await provider.searchLibrary("nonexistent", "anything");
      expect(results).toEqual([]);
    });

    it("sends Authorization header", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const provider = new Context7DocsProvider("ctx7sk_mykey");
      await provider.searchLibrary("react", "hooks");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers.Authorization).toBe("Bearer ctx7sk_mykey");
    });

    it("throws Context7Error on 401", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        status: 401,
        body: { error: "invalid_api_key", message: "Invalid API key." },
      });

      const provider = new Context7DocsProvider("bad_key");
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        Context7Error,
      );
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        /API key/i,
      );
    });

    it("throws Context7Error on 429", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        status: 429,
        body: { error: "rate_limit_exceeded", message: "Rate limit exceeded. Please try again later." },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        Context7Error,
      );
    });

    it("passes abort signal to fetch", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const controller = new AbortController();
      const provider = new Context7DocsProvider("ctx7sk_test");
      await provider.searchLibrary("react", "hooks", controller.signal);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].signal).toBe(controller.signal);
    });
  });

  describe("getContext", () => {
    it("returns text content directly", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        body: "### useState Hook\n\nSource: https://github.com/facebook/react\n\n```typescript\nconst [state, setState] = useState(0);\n```",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext(
        "/facebook/react",
        "How to use useState",
      );

      expect(result).toContain("useState Hook");
      expect(result).toContain("```typescript");
    });

    it("sends libraryId and query as URL params", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        body: "docs content",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await provider.getContext(
        "/vercel/next.js@v15.1.8",
        "app router middleware",
      );

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("libraryId=%2Fvercel%2Fnext.js%40v15.1.8");
      expect(url).toContain("query=app+router+middleware");
    });

    it("returns friendly message on 202 (library not finalized)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 202,
        body: {
          error: "library_not_finalized",
          message: "Library /new/library not finalized yet.",
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext("/new/library", "anything");
      expect(result).toContain("being processed");
      expect(result).toContain("Try again");
    });

    it("throws Context7Error on 404", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 404,
        body: { error: "library_not_found", message: "Library not found." },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/nonexistent/lib", "anything"),
      ).rejects.toThrow(Context7Error);
    });

    it("throws Context7Error on 402 (spending limit)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 402,
        body: {
          error: "spending_limit_exceeded",
          message: "Monthly spending limit reached.",
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/facebook/react", "hooks"),
      ).rejects.toThrow(Context7Error);
      await expect(
        provider.getContext("/facebook/react", "hooks"),
      ).rejects.toThrow(/spending limit/i);
    });

    it("follows 301 redirect", async () => {
      // Context7 uses application-level redirects: JSON body with redirectUrl,
      // no HTTP Location header. fetch(redirect:"follow") returns 301 as-is.
      fetchStub.addResponse(/libraryId=%2Fold%2Flibrary/, {
        status: 301,
        body: {
          error: "library_redirected",
          message: "Library /old/library has been redirected to this library: /new/location.",
          redirectUrl: "/new/location",
        },
      });
      fetchStub.addResponse(/libraryId=%2Fnew%2Flocation/, {
        body: "redirected docs",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext("/old/library", "anything");
      expect(result).toContain("redirected docs");
    });

    it("throws on redirect loop instead of infinite recursion", async () => {
      // Both /lib-a and /lib-b redirect to each other
      fetchStub.addResponse(/libraryId=%2Flib-a/, {
        status: 301,
        body: { error: "library_redirected", redirectUrl: "/lib-b" },
      });
      fetchStub.addResponse(/libraryId=%2Flib-b/, {
        status: 301,
        body: { error: "library_redirected", redirectUrl: "/lib-a" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/lib-a", "anything"),
      ).rejects.toThrow(Context7Error);
      await expect(
        provider.getContext("/lib-a", "anything"),
      ).rejects.toThrow(/too many redirects/i);
    });

    it("throws Context7Error on 500 (generic fallback)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 500,
        body: { error: "internal_error", message: "An error occurred while processing your request" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/facebook/react", "hooks"),
      ).rejects.toThrow(Context7Error);
    });
  });

  describe("providerMeta", () => {
    it("creates docs provider with key", () => {
      const { docs } = providerMeta.create("ctx7sk_test");
      expect(docs).toBeInstanceOf(Context7DocsProvider);
    });

    it("returns undefined docs without key", () => {
      const { docs } = providerMeta.create();
      expect(docs).toBeUndefined();
    });
  });
});
