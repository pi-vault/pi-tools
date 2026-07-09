import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("config ssrf defaults", () => {
  it("returns empty allowRanges by default", () => {
    // loadConfig with no config file returns defaults
    const config = loadConfig("/nonexistent/path.json");
    expect(config.ssrf).toEqual({ allowRanges: [] });
  });
});
