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

    it("migrates old format { resetAt, counts } to new format", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ resetAt: "2026-07", counts: { brave: 150, exa: 50 } }),
      );
      const adapter = createFilePersistence("/tmp/test-usage.json");
      const data = adapter.load();
      expect(data).toEqual({
        brave: { count: 150, month: "2026-07" },
        exa: { count: 50, month: "2026-07" },
      });
    });

    it("falls back to legacy pi-tools-usage.json when primary is missing", () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const p = typeof filePath === "string" ? filePath : filePath.toString();
        if (p.endsWith("pi-tools-usage.json")) {
          return JSON.stringify({ resetAt: "2026-07", counts: { exa: 75 } });
        }
        throw new Error("ENOENT");
      });
      const adapter = createFilePersistence();
      const data = adapter.load();
      expect(data).toEqual({ exa: { count: 75, month: "2026-07" } });
    });

    it("returns empty object when both files are missing", () => {
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
