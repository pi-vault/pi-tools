import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  type DashboardOptions,
  ToolsDashboardComponent,
} from "../../src/commands/tools-dashboard.ts";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";
import type { ProviderTier } from "../../src/providers/types.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

const providerState = {
  providers: {
    brave: {
      enabled: true,
      apiKey: "BRAVE_API_KEY",
      budget: { mode: "managed" as const },
    },
    duckduckgo: {
      enabled: false,
      apiKey: "literal-secret",
      budget: { mode: "unlimited" as const },
    },
  },
  defaultProvider: "brave",
};

function dashboard(
  overrides: Partial<Omit<DashboardOptions, "tui" | "theme" | "done">> = {},
  done = vi.fn(),
) {
  const tui = { requestRender: vi.fn() };
  const options: DashboardOptions = {
    tui: tui as never,
    theme: noTheme,
    providerNames: ["brave", "duckduckgo"],
    tierMap: new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
    ]),
    config: providerState,
    scope: { kind: "global", path: "/tmp/tools.json", canWrite: true },
    renderStatusTable: () => "Provider  Tier\nbrave    1",
    getActivity: () => [],
    subscribeActivity: vi.fn((_listener: () => void) => vi.fn()),
    widgetEnabled: false,
    done,
    ...overrides,
  };
  return {
    done,
    tui,
    component: new ToolsDashboardComponent(options),
  };
}

describe("ToolsDashboardComponent", () => {
  it("opens Providers and renders scope-effective provider state", () => {
    const output = dashboard().component.render(100).join("\n");

    expect(output).toContain("Providers");
    expect(output).toContain("/tmp/tools.json");
    expect(output).toContain("brave");
    expect(output).toContain("duckduckgo");
    expect(output).toContain("1");
    expect(output).toContain("3");
    expect(output).toContain("enabled");
    expect(output).toContain("disabled");
    expect(output).toContain("env: BRAVE_API_KEY");
    expect(output).toContain("set");
    expect(output).not.toContain("literal-secret");
    expect(output).toContain("managed");
    expect(output).toContain("unlimited");
    expect(output).toContain("default");
  });

  it("returns provider actions with resume state", () => {
    const toggle = dashboard();
    toggle.component.handleInput("\r");
    expect(toggle.done).toHaveBeenCalledWith({
      type: "toggle",
      provider: "brave",
      activeTab: "providers",
      selectedProvider: "brave",
    });

    const setDefault = dashboard();
    setDefault.component.handleInput("\u001b[B");
    setDefault.component.handleInput("d");
    expect(setDefault.done).toHaveBeenCalledWith({
      type: "set-default",
      provider: "duckduckgo",
      activeTab: "providers",
      selectedProvider: "duckduckgo",
    });

    const auto = dashboard();
    auto.component.handleInput("a");
    expect(auto.done).toHaveBeenCalledWith({
      type: "set-default",
      provider: "auto",
      activeTab: "providers",
      selectedProvider: "brave",
    });

    const key = dashboard();
    key.component.handleInput("k");
    expect(key.done).toHaveBeenCalledWith({
      type: "set-key",
      provider: "brave",
      activeTab: "providers",
      selectedProvider: "brave",
    });
  });

  it("makes untrusted Project scope read-only while preserving scope switching", () => {
    const readOnlyScope = {
      scope: { kind: "project" as const, path: "/repo/.pi/tools.json", canWrite: false },
    };
    const output = dashboard(readOnlyScope).component.render(100).join("\n");
    expect(output).toContain("read-only");
    expect(output).not.toContain("Enter Toggle");

    for (const key of ["\r", "k", "d", "a"]) {
      const instance = dashboard(readOnlyScope);
      instance.component.handleInput(key);
      expect(instance.done).not.toHaveBeenCalled();
    }

    for (const key of ["\u001b[D", "\u001b[C"]) {
      const instance = dashboard(readOnlyScope);
      instance.component.handleInput(key);
      expect(instance.done).toHaveBeenCalledWith({
        type: "switch-scope",
        activeTab: "providers",
        selectedProvider: "brave",
      });
    }
  });

  it("restores an available provider selection and requested tab", () => {
    const activity = dashboard({ initialTab: "activity", initialProvider: "duckduckgo" });
    expect(activity.component.render(80).join("\n")).toContain("w Enable widget");
    activity.component.handleInput("w");
    expect(activity.done).toHaveBeenCalledWith({
      type: "toggle-widget",
      activeTab: "activity",
      selectedProvider: "duckduckgo",
    });
  });

  it("returns Status reload and Activity widget actions with full resume state", () => {
    const status = dashboard({ initialTab: "status", initialProvider: "duckduckgo" });
    status.component.handleInput("r");
    expect(status.done).toHaveBeenCalledWith({
      type: "reload",
      activeTab: "status",
      selectedProvider: "duckduckgo",
    });

    const activity = dashboard({ initialTab: "activity", initialProvider: "duckduckgo" });
    activity.component.handleInput("w");
    expect(activity.done).toHaveBeenCalledWith({
      type: "toggle-widget",
      activeTab: "activity",
      selectedProvider: "duckduckgo",
    });
  });

  it("cycles Providers, Status, Activity, then wraps with Shift-Tab", () => {
    const { component, tui } = dashboard();

    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("r Reload");
    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("w Enable widget");
    component.handleInput("\u001b[Z");
    expect(component.render(80).join("\n")).toContain("r Reload");
    component.handleInput("\u001b[Z");
    expect(component.render(80).join("\n")).toContain("Enter Toggle");
    component.handleInput("\u001b[Z");
    expect(component.render(80).join("\n")).toContain("w Enable widget");
    expect(tui.requestRender).toHaveBeenCalledTimes(5);
  });

  it("keeps the selected provider in a bounded ten-row window", () => {
    const names = Array.from({ length: 12 }, (_, index) => `provider-${index + 1}`);
    const providers = Object.fromEntries(
      names.map((name) => [name, { enabled: true, budget: { mode: "managed" as const } }]),
    );
    const { component } = dashboard({
      providerNames: names,
      tierMap: new Map(names.map((name) => [name, 2 as ProviderTier])),
      config: { providers, defaultProvider: "auto" },
    });

    for (let index = 0; index < 11; index += 1) component.handleInput("\u001b[B");
    const lines = component.render(80);
    const output = lines.join("\n");

    expect(output).toContain("provider-12");
    expect(output).toContain("Showing 3–12 of 12");
    expect(output).not.toContain("provider-1 ");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
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
    const output = dashboard({ getActivity: () => entries, initialTab: "activity" })
      .component.render(140)
      .join("\n");

    expect(output).not.toContain("query-0");
    expect(output).toContain("query-10");
  });

  it("renders the Activity empty state and current widget action", () => {
    expect(
      dashboard({ initialTab: "activity", widgetEnabled: false }).component.render(80).join("\n"),
    ).toContain("w Enable widget");
    expect(
      dashboard({ initialTab: "activity", widgetEnabled: true }).component.render(80).join("\n"),
    ).toContain("w Disable widget");
  });

  it("ignores tab-specific keys on other tabs", () => {
    for (const key of ["w", "a", "d", "k", "\r"]) {
      const status = dashboard({ initialTab: "status" });
      status.component.handleInput(key);
      expect(status.done).not.toHaveBeenCalled();
    }

    const activity = dashboard({ initialTab: "activity" });
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
    const { component, tui } = dashboard({ subscribeActivity: subscribe });

    listener?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();

    component.handleInput("q");
    component.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();

    listener?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();
  });

  it.each([40, 80, 140])("keeps every tab within width %i", (width) => {
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
    for (const tab of ["providers", "status", "activity"] as const) {
      const lines = dashboard({ initialTab: tab, getActivity: () => entries }).component.render(
        width,
      );
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
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
