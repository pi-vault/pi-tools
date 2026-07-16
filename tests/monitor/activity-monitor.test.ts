import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityMonitor,
  type ActivityEntry,
} from "../../src/monitor/activity-monitor.ts";

describe("ActivityMonitor", () => {
  let monitor: ActivityMonitor;

  beforeEach(() => {
    monitor = new ActivityMonitor();
  });

  it("logStart creates an entry with status null", () => {
    const id = monitor.logStart({ type: "api", query: "react hooks" });

    expect(id).toBe("1");
    const entries = monitor.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "1",
      type: "api",
      query: "react hooks",
      status: null,
    });
    expect(entries[0].startTime).toBeGreaterThan(0);
    expect(entries[0].endTime).toBeUndefined();
  });

  it("logComplete updates entry with status and endTime", () => {
    const id = monitor.logStart({ type: "fetch", url: "https://example.com" });
    monitor.logComplete(id, 200);

    const entry = monitor.getEntries()[0];
    expect(entry.status).toBe(200);
    expect(entry.endTime).toBeGreaterThan(0);
    expect(entry.error).toBeUndefined();
  });

  it("logError updates entry with error and status -1", () => {
    const id = monitor.logStart({ type: "api", query: "test" });
    monitor.logError(id, "Connection refused");

    const entry = monitor.getEntries()[0];
    expect(entry.status).toBe(-1);
    expect(entry.error).toBe("Connection refused");
    expect(entry.endTime).toBeGreaterThan(0);
  });

  it("evicts oldest entry when buffer exceeds 10", () => {
    for (let i = 0; i < 12; i++) {
      monitor.logStart({ type: "api", query: `query-${i}` });
    }

    const entries = monitor.getEntries();
    expect(entries).toHaveLength(10);
    // Oldest two evicted: query-0 and query-1 gone
    expect(entries[0].query).toBe("query-2");
    expect(entries[9].query).toBe("query-11");
  });

  it("assigns incrementing IDs", () => {
    const id1 = monitor.logStart({ type: "api", query: "a" });
    const id2 = monitor.logStart({ type: "fetch", url: "https://b.com" });

    expect(id1).toBe("1");
    expect(id2).toBe("2");
  });

  it("clear removes all entries", () => {
    monitor.logStart({ type: "api", query: "a" });
    monitor.logStart({ type: "fetch", url: "https://b.com" });
    monitor.clear();

    expect(monitor.getEntries()).toHaveLength(0);
  });

  it("logComplete on unknown ID is a no-op", () => {
    monitor.logComplete("nonexistent", 200);
    expect(monitor.getEntries()).toHaveLength(0);
  });

  it("logError on unknown ID is a no-op", () => {
    monitor.logError("nonexistent", "fail");
    expect(monitor.getEntries()).toHaveLength(0);
  });

  describe("listeners", () => {
    it("onUpdate fires callback on logStart", () => {
      const cb = vi.fn();
      monitor.onUpdate(cb);
      monitor.logStart({ type: "api", query: "test" });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("onUpdate fires callback on logComplete", () => {
      const cb = vi.fn();
      const id = monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.logComplete(id, 200);

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("onUpdate fires callback on logError", () => {
      const cb = vi.fn();
      const id = monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.logError(id, "fail");

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("unsubscribe stops callback from firing", () => {
      const cb = vi.fn();
      const unsub = monitor.onUpdate(cb);
      unsub();
      monitor.logStart({ type: "api", query: "test" });

      expect(cb).not.toHaveBeenCalled();
    });

    it("clear does not fire listeners", () => {
      const cb = vi.fn();
      monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.clear();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  it("getEntries returns a read-only snapshot", () => {
    monitor.logStart({ type: "api", query: "test" });
    const entries = monitor.getEntries();
    expect(entries).toHaveLength(1);

    // Mutating the returned array should not affect internal state
    (entries as ActivityEntry[]).length = 0;
    expect(monitor.getEntries()).toHaveLength(1);
  });
});
