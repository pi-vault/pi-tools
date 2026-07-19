import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilePersistence } from "../../src/providers/registry.ts";
import * as fs from "node:fs";

vi.mock("node:fs");

describe("createFilePersistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15"));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("load", () => {
    it("loads current month data in new format", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ brave: { count: 42, month: "2026-07" } }),
      );
      const adapter = createFilePersistence("/tmp/test-usage.json");
      const data = adapter.load();
      expect(data).toEqual({ brave: { count: 42, month: "2026-07" } });
    });

    it("returns empty object when file is missing", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const adapter = createFilePersistence("/tmp/test-usage.json");
      const data = adapter.load();
      expect(data).toEqual({});
    });

    it("returns empty object on malformed JSON", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("not json at all");
      const adapter = createFilePersistence("/tmp/test-usage.json");
      const data = adapter.load();
      expect(data).toEqual({});
    });
  });

  describe("save", () => {
    it("uses Pi's agent cache directory by default", () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/pi-agent");
      const adapter = createFilePersistence();

      adapter.save({ brave: { count: 10, month: "2026-07" } });

      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/pi-agent/cache/pi-tools", {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/tmp/pi-agent/cache/pi-tools/usage.json",
        JSON.stringify({ brave: { count: 10, month: "2026-07" } }, null, 2),
      );
    });

    it("writes data as JSON to the primary path", () => {
      const adapter = createFilePersistence("/tmp/test-usage.json");
      adapter.save({ brave: { count: 10, month: "2026-07" } });

      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp", { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/tmp/test-usage.json",
        JSON.stringify({ brave: { count: 10, month: "2026-07" } }, null, 2),
      );
    });

    it("is silent on write failure", () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("EACCES");
      });
      const adapter = createFilePersistence("/tmp/test-usage.json");
      // Should not throw
      expect(() => adapter.save({ brave: { count: 1, month: "2026-07" } })).not.toThrow();
    });
  });
});
