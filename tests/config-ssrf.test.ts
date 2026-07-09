import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("config ssrf defaults", () => {
  it("returns empty allowRanges by default", () => {
    // loadConfig with no config file returns defaults
    const config = loadConfig("/nonexistent/path.json");
    expect(config.ssrf).toEqual({ allowRanges: [] });
  });
});

describe("config ssrf from file", () => {
  it("loads allowRanges from config file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ssrf: { allowRanges: ["198.18.0.0/15", "fd00::/8"] },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.ssrf.allowRanges).toEqual(["198.18.0.0/15", "fd00::/8"]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("defaults to empty when ssrf key is absent in file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(configPath, JSON.stringify({ defaultProvider: "brave" }));

    const config = loadConfig(configPath);
    expect(config.ssrf).toEqual({ allowRanges: [] });

    fs.rmSync(tmpDir, { recursive: true });
  });
});
