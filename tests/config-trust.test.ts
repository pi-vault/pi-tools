import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripSensitiveFields, loadMergedConfig } from "../src/config.ts";
import { recordProjectTrust, _resetTrustRegistry } from "../src/utils/trust.ts";

vi.mock("node:fs");

describe("stripSensitiveFields", () => {
  it("removes top-level apiKey fields", () => {
    const config = { gemini: { apiKey: "secret-123", baseUrl: "https://example.com" } };
    const result = stripSensitiveFields(config);
    expect(result.gemini).toEqual({ baseUrl: "https://example.com" });
  });

  it("removes nested provider apiKey fields", () => {
    const config = {
      providers: {
        brave: {
          enabled: true,
          apiKey: "BSA_xxx",
          budget: { mode: "hard", limit: 5, period: "month", unit: "usd" },
        },
        duckduckgo: { enabled: true },
      },
    };
    const result = stripSensitiveFields(config);
    expect((result.providers as any).brave).toEqual({
      enabled: true,
      budget: { mode: "hard", limit: 5, period: "month", unit: "usd" },
    });
    expect((result.providers as any).duckduckgo).toEqual({ enabled: true });
  });

  it("removes ssrf.allowRanges", () => {
    const config = { ssrf: { allowRanges: ["10.0.0.0/8"] } };
    const result = stripSensitiveFields(config);
    expect(result.ssrf).toEqual({});
  });

  it("removes gemini.cloudflareApiKey and gemini.allowBrowserCookies", () => {
    const config = {
      gemini: {
        apiKey: "key",
        baseUrl: "https://example.com",
        cloudflareApiKey: "cf-key",
        allowBrowserCookies: true,
        chromeProfile: "Default",
      },
    };
    const result = stripSensitiveFields(config);
    expect(result.gemini).toEqual({ baseUrl: "https://example.com", chromeProfile: "Default" });
  });

  it("removes fields matching *.apiSecret and *.token patterns", () => {
    const config = {
      custom: { apiSecret: "secret", token: "tok-123", name: "safe" },
    };
    const result = stripSensitiveFields(config);
    expect(result.custom).toEqual({ name: "safe" });
  });

  it("preserves non-sensitive fields", () => {
    const config = {
      defaultProvider: "brave",
      selectionStrategy: "auto",
      guidance: { web_fetch: { promptSnippet: "Use web_fetch" } },
      combine: { enabled: true, mode: "targeted" },
      pdf: { ocrEnabled: true, ocrMaxPages: 5 },
      youtube: { enabled: true },
      video: { enabled: true },
    };
    const result = stripSensitiveFields(config);
    expect(result).toEqual(config);
  });

  it("returns empty object for empty input", () => {
    expect(stripSensitiveFields({})).toEqual({});
  });
});

describe("loadMergedConfig trust gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetTrustRegistry();
  });

  afterEach(() => {
    _resetTrustRegistry();
  });

  it("strips sensitive fields from untrusted project config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      if (p.includes(".pi/tools.json") && p.includes("test-project")) {
        return JSON.stringify({
          gemini: { apiKey: "malicious-key" },
          guidance: { web_fetch: { promptSnippet: "safe" } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      return p.includes("test-project") && p.includes(".pi/tools.json");
    });

    // Not trusted (no recordProjectTrust call)
    const config = loadMergedConfig("/test-project");
    expect(config.gemini?.apiKey).toBeUndefined();
    expect(config.guidance?.web_fetch?.promptSnippet).toBe("safe");
  });

  it("preserves sensitive fields from trusted project config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      if (p.includes(".pi/tools.json") && p.includes("test-project")) {
        return JSON.stringify({
          gemini: { apiKey: "trusted-key" },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      return p.includes("test-project") && p.includes(".pi/tools.json");
    });

    recordProjectTrust({ cwd: "/test-project", isProjectTrusted: () => true });
    const config = loadMergedConfig("/test-project");
    expect(config.gemini?.apiKey).toBe("trusted-key");
  });
});
