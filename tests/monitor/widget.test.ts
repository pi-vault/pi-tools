import { describe, expect, it } from "vitest";
import {
  formatEntryLine,
  renderWidgetLines,
} from "../../src/monitor/widget.ts";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";

// Stub theme: no-op coloring (returns text unchanged)
const plainTheme = {
  fg: (_color: string, text: string) => text,
};

describe("formatEntryLine", () => {
  it("formats a completed API entry", () => {
    const entry: ActivityEntry = {
      id: "1",
      type: "api",
      startTime: 1000,
      endTime: 1200,
      query: "react hooks",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("API");
    expect(line).toContain("react hooks");
    expect(line).toContain("200");
    expect(line).toContain("0.2s");
  });

  it("formats a completed fetch entry", () => {
    const entry: ActivityEntry = {
      id: "2",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/page",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("GET");
    expect(line).toContain("example.com/page");
    expect(line).toContain("200");
  });

  it("formats a pending entry with spinner indicator", () => {
    const entry: ActivityEntry = {
      id: "3",
      type: "api",
      startTime: Date.now() - 500,
      query: "typescript patterns",
      status: null,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("API");
    expect(line).toContain("...");
  });

  it("formats an error entry with failure indicator", () => {
    const entry: ActivityEntry = {
      id: "4",
      type: "api",
      startTime: 1000,
      endTime: 2200,
      query: "test query",
      status: 429,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("429");
  });

  it("truncates long URLs", () => {
    const entry: ActivityEntry = {
      id: "5",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/very/long/path/that/exceeds/the/maximum/column/width/for/display",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    // URL should be truncated to fit within display width
    expect(line.length).toBeLessThan(200);
  });

  it("strips https:// prefix from URLs", () => {
    const entry: ActivityEntry = {
      id: "6",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/page",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).not.toContain("https://");
    expect(line).toContain("example.com/page");
  });

  it("handles missing query with fallback", () => {
    const entry: ActivityEntry = {
      id: "7",
      type: "api",
      startTime: 1000,
      endTime: 1200,
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);
    expect(line).toContain('"?"');
  });

  it("handles missing url with fallback", () => {
    const entry: ActivityEntry = {
      id: "8",
      type: "fetch",
      startTime: 1000,
      endTime: 1200,
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);
    expect(line).toContain("?");
  });

  it("truncates long queries", () => {
    const entry: ActivityEntry = {
      id: "9",
      type: "api",
      startTime: 1000,
      endTime: 1200,
      query: "a".repeat(100),
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);
    expect(line).toContain("\u2026"); // ellipsis character
    expect(line).not.toContain('"' + "a".repeat(100) + '"'); // full query not present
  });

  it("strips http:// prefix from URLs", () => {
    const entry: ActivityEntry = {
      id: "10",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "http://example.com/page",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);
    expect(line).not.toContain("http://");
    expect(line).toContain("example.com/page");
  });

  it("treats status -1 as an error (non-success indicator)", () => {
    const entry: ActivityEntry = {
      id: "11",
      type: "api",
      startTime: 1000,
      endTime: 1500,
      query: "test",
      status: -1,
      error: "Connection refused",
    };
    const line = formatEntryLine(entry, plainTheme);
    expect(line).toContain("-1");
    expect(line).toContain("\u2717"); // ✗ error indicator
  });
});

describe("renderWidgetLines", () => {
  it("renders empty state", () => {
    const lines = renderWidgetLines([], plainTheme);

    expect(lines.length).toBeGreaterThanOrEqual(3); // header + message + footer
    expect(lines.join("\n")).toContain("No activity yet");
  });

  it("renders entries with header and footer", () => {
    const entries: ActivityEntry[] = [
      {
        id: "1",
        type: "api",
        startTime: 1000,
        endTime: 1200,
        query: "test",
        status: 200,
      },
    ];
    const lines = renderWidgetLines(entries, plainTheme);
    const text = lines.join("\n");

    expect(text).toContain("Web Tools Activity");
    expect(text).toContain("API");
    expect(text).toContain("test");
  });

  it("renders multiple entries", () => {
    const entries: ActivityEntry[] = [
      {
        id: "1",
        type: "api",
        startTime: 1000,
        endTime: 1200,
        query: "query-a",
        status: 200,
      },
      {
        id: "2",
        type: "fetch",
        startTime: 1000,
        endTime: 1500,
        url: "https://b.com",
        status: 404,
      },
    ];
    const lines = renderWidgetLines(entries, plainTheme);
    const text = lines.join("\n");

    expect(text).toContain("query-a");
    expect(text).toContain("b.com");
  });

  it("returns an array of strings", () => {
    const lines = renderWidgetLines([], plainTheme);
    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines) {
      expect(typeof line).toBe("string");
    }
  });
});
