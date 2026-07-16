import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ActivityEntry } from "./activity-monitor.ts";

/** Minimal theme contract for testability — matches ctx.ui.theme at runtime. */
export interface ThemeLike {
  fg: (color: ThemeColor, text: string) => string;
}

const TARGET_WIDTH = 34;

function formatDuration(startTime: number, endTime?: number): string {
  const elapsed = (endTime ?? Date.now()) - startTime;
  return `${(elapsed / 1000).toFixed(1)}s`;
}

function formatTarget(entry: ActivityEntry): string {
  if (entry.type === "api") {
    const q = entry.query ?? "?";
    const display = q.length > TARGET_WIDTH ? q.slice(0, TARGET_WIDTH - 1) + "\u2026" : q;
    return `"${display}"`;
  }
  const raw = (entry.url ?? "?").replace(/^https?:\/\//, "");
  return raw.length > TARGET_WIDTH ? raw.slice(0, TARGET_WIDTH - 1) + "\u2026" : raw;
}

function statusIndicator(entry: ActivityEntry, theme: ThemeLike): string {
  if (entry.status === null) return "\u22EF"; // pending: ⋯
  if (entry.status >= 200 && entry.status < 400) return theme.fg("success", "\u2713"); // ✓
  return theme.fg("error", "\u2717"); // ✗
}

export function formatEntryLine(entry: ActivityEntry, theme: ThemeLike): string {
  const typeLabel = entry.type === "api" ? "API" : "GET";
  const target = formatTarget(entry);
  const statusStr = entry.status === null ? "..." : String(entry.status);
  const duration = formatDuration(entry.startTime, entry.endTime);
  const indicator = statusIndicator(entry, theme);

  return [
    typeLabel.padEnd(5),
    target.padEnd(TARGET_WIDTH + 2),
    statusStr.padStart(4),
    duration.padStart(6),
    indicator,
  ].join("  ");
}

export function renderWidgetLines(
  entries: ReadonlyArray<ActivityEntry>,
  theme: ThemeLike,
): string[] {
  const lines: string[] = [];

  lines.push(theme.fg("accent", "--- Web Tools Activity " + "-".repeat(37)));

  if (entries.length === 0) {
    lines.push(theme.fg("muted", "  No activity yet"));
  } else {
    for (const entry of entries) {
      lines.push("  " + formatEntryLine(entry, theme));
    }
  }

  lines.push(theme.fg("accent", "-".repeat(60)));
  return lines;
}
