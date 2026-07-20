import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  noTheme,
  padVisible,
  truncateVisible,
  wrapVisible,
} from "../../src/tui/dashboard-theme.ts";

describe("dashboard theme helpers", () => {
  it("provides every tools status color through the passthrough theme", () => {
    expect(noTheme.fg("success", "ok")).toBe("ok");
    expect(noTheme.fg("error", "bad")).toBe("bad");
    expect(noTheme.fg("warning", "warn")).toBe("warn");
    expect(noTheme.bg("selectedBg", "selected")).toBe("selected");
  });

  it("pads, truncates, and wraps ANSI-styled text by visible width", () => {
    const styled = "\u001b[31mabcdef\u001b[0m";
    expect(visibleWidth(padVisible(styled, 8))).toBe(8);
    expect(visibleWidth(truncateVisible(styled, 3))).toBe(3);
    expect(wrapVisible(`one ${styled} three`, 7).every((line) => visibleWidth(line) <= 7)).toBe(
      true,
    );
  });
});
