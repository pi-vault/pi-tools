/**
 * Theme adapter and ANSI-safe layout helpers for the usage dashboard.
 *
 * The dashboard is rendered into Pi's TUI, which emits ANSI-styled text and
 * performs differential rendering. To keep alignment, padding, and truncation
 * correct under all of those styling escapes we operate on ANSI-visible width
 * rather than raw code-unit length.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * Minimal subset of the Pi {@link Theme} surface used by the dashboard.
 * Decoupling the dashboard from the concrete Theme class keeps unit tests
 * free from the rest of the agent's theme module.
 */
export interface DashboardTheme {
  /** Foreground color for a themed string. */
  fg: (color: DashboardColor, text: string) => string;
  /** Background color for a themed string. */
  bg: (color: DashboardColor, text: string) => string;
  /** Bold modifier. */
  bold: (text: string) => string;
  /** Dim modifier. */
  dim: (text: string) => string;
  /** Inverse modifier (swap fg/bg). */
  inverse: (text: string) => string;
}

/**
 * Color roles referenced by the dashboard. Foreground names match
 * `ThemeColor` entries; `"selectedBg"` maps to the `ThemeBg` palette
 * and is only valid with `bg()`.
 */
export type DashboardColor =
  | "accent"
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "muted"
  | "dim"
  | "text"
  | "success"
  | "error"
  | "warning";

/**
 * A no-theme variant. Returns input untouched. Useful for unit tests that
 * only assert plain text content.
 */
export const noTheme: DashboardTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  inverse: (text) => text,
};

/**
 * Build a {@link DashboardTheme} adapter around the Pi {@link Theme} instance.
 * The agent's `Theme` exposes `fg(color, text)` for color roles and a `bold`
 * helper; the `dim` look is provided by the `dim` color role. Wrapping the
 * live theme keeps the dashboard colors in sync with the rest of Pi.
 */
export function fromPiTheme(theme: Theme): DashboardTheme {
  return {
    fg: (color, text) => theme.fg(color as never, text),
    bg: (color, text) => theme.bg(color as never, text),
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    inverse: (text) => theme.inverse(text),
  };
}

/**
 * ANSI-safe truncation. Drops the visible tail of `text` so the visible width
 * does not exceed `maxWidth`. Preserves the styling tail so subsequent styled
 * segments are not corrupted when the truncation is concatenated.
 */
export function truncateVisible(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  return truncateToWidth(text, maxWidth, ellipsis);
}

/**
 * Pad `text` to exactly `width` visible columns. Caller-supplied alignment
 * controls left vs right padding. Returns empty string if width is <= 0.
 */
export function padVisible(text: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) return "";
  const current = visibleWidth(text);
  if (current >= width) return text;
  const padding = " ".repeat(width - current);
  return align === "right" ? `${padding}${text}` : `${text}${padding}`;
}

/**
 * Wrap an ANSI-styled string into lines of at most `width` visible columns.
 * Preserves style state across line breaks via `wrapTextWithAnsi`.
 */
export function wrapVisible(text: string, width: number): string[] {
  if (width <= 0) return [];
  return wrapTextWithAnsi(text, width);
}
