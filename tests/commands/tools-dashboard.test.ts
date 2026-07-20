import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  type DashboardTabId,
  ToolsDashboardComponent,
} from "../../src/commands/tools-dashboard.ts";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

function dashboard(
  done = vi.fn(),
  activity: readonly ActivityEntry[] = [],
  subscribeActivity = vi.fn((_listener: () => void) => vi.fn()),
  initialTab: DashboardTabId = "status",
  widgetEnabled = false,
) {
  const tui = { requestRender: vi.fn() };
  return {
    done,
    tui,
    subscribeActivity,
    component: new ToolsDashboardComponent({
      tui: tui as never,
      theme: noTheme,
      renderStatusTable: () => "Provider  Tier\nbrave    1",
      getActivity: () => activity,
      subscribeActivity,
      widgetEnabled,
      initialTab,
      done,
    }),
  };
}

describe("ToolsDashboardComponent", () => {
  it("renders the Status tab and existing status table", () => {
    const output = dashboard().component.render(80).join("\n");
    expect(output).toContain("Status");
    expect(output).toContain("Provider");
    expect(output).toContain("brave");
    expect(output).toContain("┏");
    expect(output).toContain("┛");
  });

  it.each([40, 80, 140])("keeps every Status line within width %i", (width) => {
    expect(
      dashboard()
        .component.render(width)
        .every((line) => visibleWidth(line) <= width),
    ).toBe(true);
  });

  it("switches between Status and Activity with Tab and Shift-Tab", () => {
    const { component, tui } = dashboard();

    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("w Enable widget");
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    component.handleInput("\u001b[Z");
    expect(component.render(80).join("\n")).toContain("r Reload");
    expect(tui.requestRender).toHaveBeenCalledTimes(2);
  });

  it("renders only the latest ten activity entries", () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({
      id: String(index),
      type: "api" as const,
      startTime: 0,
      endTime: 100,
      status: 200,
      query: `query-${index}`,
    }));
    const { component } = dashboard(vi.fn(), entries, undefined, "activity");
    const output = component.render(140).join("\n");

    expect(output).not.toContain("query-0");
    expect(output).toContain("query-10");
  });

  it("renders the Activity empty state and current widget action", () => {
    expect(
      dashboard(vi.fn(), [], undefined, "activity", false).component.render(80).join("\n"),
    ).toContain("w Enable widget");
    expect(
      dashboard(vi.fn(), [], undefined, "activity", true).component.render(80).join("\n"),
    ).toContain("w Disable widget");
  });

  it("returns contextual actions with resume state", () => {
    const status = dashboard();
    status.component.handleInput("r");
    expect(status.done).toHaveBeenCalledWith({
      type: "reload",
      activeTab: "status",
    });

    const activity = dashboard(vi.fn(), [], undefined, "activity");
    activity.component.handleInput("w");
    expect(activity.done).toHaveBeenCalledWith({
      type: "toggle-widget",
      activeTab: "activity",
    });
  });

  it("ignores tab-specific keys on the other tab", () => {
    const status = dashboard();
    status.component.handleInput("w");
    expect(status.done).not.toHaveBeenCalled();

    const activity = dashboard(vi.fn(), [], undefined, "activity");
    activity.component.handleInput("r");
    expect(activity.done).not.toHaveBeenCalled();
  });

  it("repaints on activity and unsubscribes once across both disposal paths", () => {
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((next: () => void) => {
      listener = next;
      return unsubscribe;
    });
    const { component, tui } = dashboard(vi.fn(), [], subscribe);

    listener?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();

    component.handleInput("q");
    component.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();

    listener?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();
  });

  it.each([40, 80, 140])("keeps Activity within width %i", (width) => {
    const entries: ActivityEntry[] = [
      {
        id: "1",
        type: "api",
        startTime: 0,
        endTime: 100,
        status: 200,
        query: "x".repeat(100),
      },
    ];
    expect(
      dashboard(vi.fn(), entries, undefined, "activity")
        .component.render(width)
        .every((line) => visibleWidth(line) <= width),
    ).toBe(true);
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
