import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../src/providers/usage.ts";
import * as fs from "node:fs";

vi.mock("node:fs");

describe("UsageTracker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with zero counts for all providers", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
    expect(tracker.getCount("exa")).toBe(0);
  });

  it("increments usage count", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(1);
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(2);
  });

  it("loads persisted counts", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-07",
        counts: { brave: 150, exa: 50 },
      }),
    );
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(150);
    expect(tracker.getCount("exa")).toBe(50);
  });

  it("resets counts when month changes", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-06",
        counts: { brave: 999 },
      }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
  });

  it("calculates remaining quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getRemaining("brave", 2000)).toBe(1999);
  });

  it("returns Infinity remaining for unlimited quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getRemaining("perplexity", null)).toBe(Infinity);
  });
});
