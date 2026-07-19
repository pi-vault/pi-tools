import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFilePersistence } from "../../src/providers/registry.ts";

vi.mock("node:fs");

const empty = { version: 2 as const, counters: {} };

describe("createFilePersistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  it("loads v2 counters", () => {
    const data = {
      version: 2,
      counters: {
        brave: { used: 1.25, unit: "usd", period: "month", periodKey: "2026-07" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data));

    expect(createFilePersistence("/tmp/usage.json").load()).toEqual(data);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 3, counters: {} }),
    JSON.stringify({ version: 2, counters: [] }),
    JSON.stringify({ version: 2, counters: { brave: { used: "one" } } }),
  ])("loads malformed or unknown data as empty v2 state", (raw) => {
    vi.mocked(fs.readFileSync).mockReturnValue(raw);
    expect(createFilePersistence("/tmp/usage.json").load()).toEqual(empty);
  });

  it("retains legacy records for registry migration", () => {
    const legacy = { brave: { count: 42, month: "2026-07" } };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacy));
    expect(createFilePersistence("/tmp/usage.json").load()).toEqual(legacy);
  });

  it("uses Pi's agent cache directory and writes synchronously", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/pi-agent");
    createFilePersistence().save(empty);

    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/pi-agent/cache/pi-tools", {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/pi-agent/cache/pi-tools/usage.json",
      JSON.stringify(empty, null, 2),
    );
  });

  it("treats missing files and write failures as non-fatal", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const adapter = createFilePersistence("/tmp/usage.json");
    expect(adapter.load()).toEqual(empty);

    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(() => adapter.save(empty)).not.toThrow();
  });
});
