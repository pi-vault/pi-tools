import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ToolsDashboardComponent } from "../../src/commands/tools-dashboard.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

function dashboard(done = vi.fn()) {
  const tui = { requestRender: vi.fn() } as never;
  return {
    done,
    tui,
    component: new ToolsDashboardComponent({
      tui,
      theme: noTheme,
      renderStatusTable: () => "Provider  Tier\nbrave    1",
      done,
    }),
  };
}

describe("ToolsDashboardComponent status slice", () => {
  it("renders the Status tab and existing status table", () => {
    const output = dashboard().component.render(80).join("\n");
    expect(output).toContain("Status");
    expect(output).toContain("Provider");
    expect(output).toContain("brave");
    expect(output).toContain("┏");
    expect(output).toContain("┛");
  });

  it.each([40, 80, 140])("keeps every line within width %i", (width) => {
    expect(
      dashboard()
        .component.render(width)
        .every((line) => visibleWidth(line) <= width),
    ).toBe(true);
  });

  it("returns reload for r", () => {
    const { component, done } = dashboard();
    component.handleInput("r");
    expect(done).toHaveBeenCalledWith({ type: "reload" });
  });

  it("returns close for q and Escape", () => {
    const first = dashboard();
    first.component.handleInput("q");
    expect(first.done).toHaveBeenCalledWith({ type: "close" });

    const second = dashboard();
    second.component.handleInput("\u001b");
    expect(second.done).toHaveBeenCalledWith({ type: "close" });
  });
});
