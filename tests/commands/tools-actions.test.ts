import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyCredential,
  findWritableProjectPath,
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
