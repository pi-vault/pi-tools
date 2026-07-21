import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyCredential,
  findWritableProjectPath,
  runProviderTest,
  runProviderTests,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
  updateScopedConfig,
} from "../../src/commands/tools-actions.ts";

vi.mock("node:fs");

afterEach(() => vi.restoreAllMocks());

describe("project credential policy", () => {
  it("classifies env names, literals, and shell commands", () => {
    expect(classifyCredential("BRAVE_API_KEY")).toBe("env");
    expect(classifyCredential("literal-secret")).toBe("literal");
    expect(classifyCredential("!op read op://vault/key")).toBe("shell");
    expect(classifyCredential("lower_case")).toBe("literal");
  });

  it.each(["literal-secret", "!op read op://vault/key", "lower_case"])(
    "rejects project credential %s before reading or writing",
    (value) => {
      expect(() =>
        setProviderKey({ scope: "project", cwd: "/repo", trusted: true }, "brave", value),
      ).toThrow(/environment-variable/i);
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    },
  );

  it("writes project environment-variable names", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    setProviderKey({ scope: "project", cwd: "/repo", trusted: true }, "brave", "BRAVE_API_KEY");

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.providers.brave.apiKey).toBe("BRAVE_API_KEY");
  });

  it.each(["literal-secret", "!op read op://vault/key"])("writes global credential %s", (value) => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    setProviderKey({ scope: "global", cwd: "/repo", trusted: true }, "brave", value);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.providers.brave.apiKey).toBe(value);
  });
});

describe("project config target", () => {
  it("uses the nearest existing project file", () => {
    const target = path.join("/repo", CONFIG_DIR_NAME, "tools.json");
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === target);
    expect(findWritableProjectPath("/repo/packages/app")).toBe(target);
  });

  it("falls back to cwd when no project file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(findWritableProjectPath("/repo/packages/app")).toBe(
      path.join("/repo/packages/app", CONFIG_DIR_NAME, "tools.json"),
    );
  });

  it.each([
    {
      cwd: "/repo/packages/app",
      target: path.join("/repo", CONFIG_DIR_NAME, "tools.json"),
      existing: true,
    },
    {
      cwd: "/repo/packages/app",
      target: path.join("/repo/packages/app", CONFIG_DIR_NAME, "tools.json"),
      existing: false,
    },
  ])("writes to the resolved project target %#", ({ cwd, target, existing }) => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => existing && candidate === target);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    setProviderEnabled({ scope: "project", cwd, trusted: true }, "brave", true);

    expect(fs.writeFileSync).toHaveBeenCalledWith(target, expect.any(String));
  });
});

describe("safe read-modify-write", () => {
  it("preserves unknown root and provider fields", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        extra: { keep: true },
        providers: { brave: { enabled: false, custom: 7 } },
      }),
    );

    setProviderEnabled({ scope: "global", cwd: "/repo", trusted: true }, "brave", true);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.extra.keep).toBe(true);
    expect(written.providers.brave.custom).toBe(7);
    expect(written.providers.brave.enabled).toBe(true);
  });

  it.each(["{ malformed", "null", "[]"])("does not overwrite invalid document %s", (raw) => {
    vi.mocked(fs.readFileSync).mockReturnValue(raw);
    expect(() =>
      updateScopedConfig({ scope: "global", cwd: "/repo", trusted: true }, (document) => document),
    ).toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("does not overwrite on non-ENOENT read errors", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    expect(() =>
      updateScopedConfig({ scope: "global", cwd: "/repo", trusted: true }, (document) => document),
    ).toThrow("permission denied");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates an empty document only for ENOENT", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    setProviderEnabled({ scope: "project", cwd: "/repo", trusted: true }, "brave", true);
    expect(fs.writeFileSync).toHaveBeenCalledOnce();
  });

  it("rejects every untrusted project write before reading", () => {
    expect(() =>
      setDefaultProvider(
        { scope: "project", cwd: "/repo", trusted: false },
        "auto",
        new Set(["brave"]),
      ),
    ).toThrow(/trusted/i);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([{ providers: [] }, { providers: { brave: "malformed" } }])(
    "does not replace malformed provider structure %#",
    (document) => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(document));
      expect(() =>
        setProviderEnabled({ scope: "global", cwd: "/repo", trusted: true }, "brave", true),
      ).toThrow(/provider/i);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    },
  );
});

describe("provider tests", () => {
  it("returns aborted without selecting a provider when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const selectSearchCandidates = vi.fn(() => []);
    const registry = { selectSearchCandidates } as never;

    await expect(runProviderTest("brave", registry, controller.signal)).resolves.toEqual({
      provider: "brave",
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "aborted",
    });
    expect(selectSearchCandidates).not.toHaveBeenCalled();
  });

  it("passes the raw AbortSignal as search argument three", async () => {
    const search = vi.fn().mockResolvedValue([{ url: "https://example.com" }]);
    const registry = {
      selectSearchCandidates: vi.fn(() => [{ name: "brave", label: "Brave", search }]),
    } as never;
    const controller = new AbortController();

    const result = await runProviderTest("brave", registry, controller.signal);

    expect(search).toHaveBeenCalledWith("test", 1, controller.signal);
    expect(result).toMatchObject({
      provider: "brave",
      ok: true,
      resultCount: 1,
      message: "OK",
    });
  });

  it("returns a failed result for an unavailable provider", async () => {
    const registry = { selectSearchCandidates: vi.fn(() => []) } as never;

    await expect(
      runProviderTest("missing", registry, new AbortController().signal),
    ).resolves.toEqual({
      provider: "missing",
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "not found or not enabled",
    });
  });

  it("converts provider rejection into a failed result", async () => {
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        {
          name: "brave",
          label: "Brave",
          search: vi.fn().mockRejectedValue(new Error("network down")),
        },
      ]),
    } as never;

    await expect(
      runProviderTest("brave", registry, new AbortController().signal),
    ).resolves.toMatchObject({
      provider: "brave",
      ok: false,
      resultCount: 0,
      message: "network down",
    });
  });

  it("reports aborted when a provider ignores cancellation and resolves", async () => {
    const controller = new AbortController();
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        {
          name: "brave",
          label: "Brave",
          search: vi.fn(async () => {
            controller.abort();
            return [{ url: "https://example.com" }];
          }),
        },
      ]),
    } as never;

    await expect(runProviderTest("brave", registry, controller.signal)).resolves.toMatchObject({
      provider: "brave",
      ok: false,
      resultCount: 0,
      message: "aborted",
    });
  });

  it("normalizes caller cancellation to aborted", async () => {
    const controller = new AbortController();
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        {
          name: "brave",
          label: "Brave",
          search: vi.fn(async () => {
            controller.abort();
            throw new DOMException("cancelled", "AbortError");
          }),
        },
      ]),
    } as never;

    await expect(runProviderTest("brave", registry, controller.signal)).resolves.toMatchObject({
      ok: false,
      message: "aborted",
    });
  });

  it("runs providers sequentially", async () => {
    let resolveFirst!: (results: { url: string }[]) => void;
    let resolveSecond!: (results: { url: string }[]) => void;
    const started: string[] = [];
    const firstSearch = vi.fn(
      () =>
        new Promise<{ url: string }[]>((resolve) => {
          started.push("first");
          resolveFirst = resolve;
        }),
    );
    const secondSearch = vi.fn(
      () =>
        new Promise<{ url: string }[]>((resolve) => {
          started.push("second");
          resolveSecond = resolve;
        }),
    );
    const registry = {
      selectSearchCandidates: vi.fn((name: string) => [
        name === "first"
          ? { name: "first", label: "First", search: firstSearch }
          : { name: "second", label: "Second", search: secondSearch },
      ]),
    } as never;

    const pending = runProviderTests(registry, ["first", "second"], new AbortController().signal);

    expect(started).toEqual(["first"]);
    expect(secondSearch).not.toHaveBeenCalled();
    resolveFirst([{ url: "https://first.example" }]);
    await vi.waitFor(() => expect(secondSearch).toHaveBeenCalledOnce());
    expect(started).toEqual(["first", "second"]);
    resolveSecond([{ url: "https://second.example" }]);

    await expect(pending).resolves.toMatchObject([
      { provider: "first", ok: true, resultCount: 1, message: "OK" },
      { provider: "second", ok: true, resultCount: 1, message: "OK" },
    ]);
  });

  it("runs providers sequentially and does not start the next after abort", async () => {
    const controller = new AbortController();
    const firstSearch = vi.fn(async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    const secondSearch = vi.fn().mockResolvedValue([]);
    const selectSearchCandidates = vi.fn((name: string) =>
      name === "first"
        ? [{ name: "first", label: "First", search: firstSearch }]
        : [{ name: "second", label: "Second", search: secondSearch }],
    );
    const registry = { selectSearchCandidates } as never;

    const results = await runProviderTests(registry, ["first", "second"], controller.signal);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ provider: "first", message: "aborted" });
    expect(secondSearch).not.toHaveBeenCalled();
    expect(selectSearchCandidates).toHaveBeenCalledTimes(1);
  });
});

describe("default provider", () => {
  it("accepts auto and known providers", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{}");

    setDefaultProvider(
      { scope: "global", cwd: "/repo", trusted: true },
      "auto",
      new Set(["brave"]),
    );
    expect(JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]))).toMatchObject({
      defaultProvider: "auto",
    });

    setDefaultProvider(
      { scope: "global", cwd: "/repo", trusted: true },
      "brave",
      new Set(["brave"]),
    );
    expect(JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[1][1]))).toMatchObject({
      defaultProvider: "brave",
    });
  });

  it("rejects unknown providers before reading or writing", () => {
    expect(() =>
      setDefaultProvider(
        { scope: "global", cwd: "/repo", trusted: true },
        "unknown",
        new Set(["brave"]),
      ),
    ).toThrow(/unknown provider/i);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
