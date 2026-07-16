import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEnhancedSetup, buildDiagnosticPreamble } from "../../src/commands/tools-setup.ts";
import { makeCtx } from "../helpers.ts";
import type { ProviderTier } from "../../src/providers/types.ts";

vi.mock("node:fs");

describe("buildDiagnosticPreamble", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports detected environment keys", () => {
    const original = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "test-key";

    const preamble = buildDiagnosticPreamble(
      ["brave", "exa"],
      new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]),
    );
    expect(preamble).toContain("BRAVE_API_KEY");
    expect(preamble).toContain("detected");

    if (original !== undefined) {
      process.env.BRAVE_API_KEY = original;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
  });

  it("reports config file status", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const preamble = buildDiagnosticPreamble(
      ["brave"],
      new Map<string, ProviderTier>([["brave", 1]]),
    );
    expect(preamble).toContain("Config file");
  });
});

describe("handleEnhancedSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("shows status when user chooses 'Just show status'", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("status");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should have shown diagnostic preamble + called select
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    // Status path notifies the user
    expect(ctx.ui.notify).toHaveBeenCalled();
  });

  it("runs quick setup for tier-1 providers", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    // User picks "Quick setup"
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("quick");
    // Prompt for brave API key
    vi.mocked(ctx.ui.input)
      .mockResolvedValueOnce("BSA_testkey12345678")
      .mockResolvedValueOnce(""); // exa: skip
    // Default provider selection
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should have written config
    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_testkey12345678");
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("runs full setup iterating all providers", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    // User picks "Full setup"
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("full");
    // brave: enable, exa: disable
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // exa: no
    // API key for brave
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("my-key");
    // Default provider
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
    expect(written.providers.exa.enabled).toBe(false);
  });

  it("handles no providers available", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const tierMap = new Map<string, ProviderTier>();

    await handleEnhancedSetup(ctx, [], tierMap);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg).toContain("No providers available");
  });

  it("handles user cancellation (select returns undefined)", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined);

    const allProviderNames = ["brave"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should not crash; no config written
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
