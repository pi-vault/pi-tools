import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { noTheme } from "../../src/tui/dashboard-theme.ts";
import { frame, frameContentWidth, pad, renderTabBar } from "../../src/tui/overlay-render.ts";

describe("tools overlay shell", () => {
  it("pads and truncates by visible width", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("hello world", 5))).toBe(5);
  });

  it("calculates frame content width", () => {
    expect(frameContentWidth(20)).toBe(14);
    expect(frameContentWidth(0)).toBe(1);
  });

  it("renders the heavy frame within the supplied width", () => {
    for (const width of [20, 40, 80]) {
      const lines = frame(["hello"], width, noTheme);
      expect(lines[0]).toContain("┏");
      expect(lines.at(-1)).toContain("┛");
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("renders an active Status pill", () => {
    const line = renderTabBar([{ id: "status", label: "Status" }], "status", 40, noTheme);
    expect(line).toContain("Status");
    expect(visibleWidth(line)).toBe(40);
  });
});
