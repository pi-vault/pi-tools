import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DashboardOptions,
  ToolsDashboardComponent,
} from "../../src/commands/tools-dashboard.ts";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";
import type { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier, SearchProvider, SearchResult } from "../../src/providers/types.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

const searchResult: SearchResult = {
  title: "Test result",
  url: "https://example.com",
  snippet: "Found",
};

const eventLoopTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => vi.restoreAllMocks());

function searchRegistry(
  providers: SearchProvider[] = [
    {
      name: "brave",
      label: "Brave",
      search: vi.fn().mockResolvedValue([searchResult]),
    },
    {
      name: "duckduckgo",
      label: "DuckDuckGo",
      search: vi.fn().mockResolvedValue([]),
    },
  ],
): ProviderRegistry {
  return {
    getSearchProviderNames: vi.fn(() => providers.map(({ name }) => name)),
    selectSearchCandidates: vi.fn((name?: string) =>
      name ? providers.filter((provider) => provider.name === name) : providers,
    ),
  } as unknown as ProviderRegistry;
}

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
    registry: searchRegistry(),
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

  it("cycles Providers, Status, Activity and wraps both ways", () => {
    const { component, tui } = dashboard();

    component.handleInput("\u001b[Z");
    expect(component.render(80).join("\n")).toContain("w Enable widget");
    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("Enter Toggle");
    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("r Reload");
    component.handleInput("\t");
    expect(component.render(80).join("\n")).toContain("w Enable widget");
    expect(tui.requestRender).toHaveBeenCalledTimes(4);
  });

  it("switches scope with left/right only from Providers", () => {
    for (const key of ["\u001b[D", "\u001b[C"]) {
      const providers = dashboard();
      providers.component.handleInput(key);
      expect(providers.done).toHaveBeenCalledWith({
        type: "switch-scope",
        activeTab: "providers",
        selectedProvider: "brave",
      });

      for (const tab of ["status", "activity"] as const) {
        const other = dashboard({ initialTab: tab });
        other.component.handleInput(key);
        expect(other.done).not.toHaveBeenCalled();
      }
    }
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
      if (width === 140) {
        expect(lines.join("\n")).toContain("Providers");
        expect(lines.join("\n")).toContain("Status");
        expect(lines.join("\n")).toContain("Activity");
        expect(lines[0]).toMatch(/^┏.*┓$/);
        expect(lines.at(-1)).toMatch(/^┗.*┛$/);
      }
    }
  });

  it.each(["providers", "status", "activity"] as const)(
    "returns close for q and Escape from %s",
    (initialTab) => {
      for (const key of ["q", "\u001b"]) {
        const instance = dashboard({ initialTab });
        instance.component.handleInput(key);
        expect(instance.done).toHaveBeenCalledWith({ type: "close" });
      }
    },
  );

  it("renders the ▸ indicator only on the selected row", () => {
    const lines = dashboard().component.render(100);
    const providerRows = lines.filter(
      (line) => line.includes("brave") || line.includes("duckduckgo"),
    );
    // Exactly one row should carry the indicator (the selected one).
    const rowsWithIndicator = providerRows.filter((row) => row.includes("▸"));
    expect(rowsWithIndicator).toHaveLength(1);
    // The unselected row should not carry the indicator anywhere.
    const unselectedRows = providerRows.filter((row) => !row.includes("▸"));
    expect(unselectedRows.length).toBeGreaterThan(0);
  });

  it("renders the indicator only on the selected Providers row", () => {
    const output = dashboard().component.render(100).join("\n");
    // Default fixture selects "brave" (providerNames[0]).
    expect(output).toContain("▸ brave");
    // Unselected row carries no indicator — alignment comes from spaces.
    expect(output).not.toContain("▸ duckduckgo");
    expect(output).not.toMatch(/^> /m);
  });


  it("preserves delimiter glyphs in Providers footer", () => {
    const output = dashboard().component.render(100).join("\n");
    expect(output).toContain("Enter Toggle • k Set key • d Set default");
  });

  it("keeps Providers row cells aligned with the column header", () => {
    const lines = dashboard().component.render(100);
    // The column header contains "Tier" but the tab bar contains "Providers"
    // (plural). Match on "Tier" to find the column header specifically.
    const header = lines.find((line) => line.includes("Tier"));
    const row = lines.find((line) => line.includes("brave"));
    expect(header).toBeDefined();
    expect(row).toBeDefined();
    // Measure the visible width from the start of each raw line to the target
    // token. The frame applies the same internal padding to every line, so
    // any frame chrome cancels out. visibleWidth counts ANSI-aware width, so
    // this stays correct when the styled nameCell injects escape codes via
    // fg/bold.
    const tierColHeader = visibleWidth(
      header!.slice(0, header!.indexOf("Tier")),
    );
    // Slice past the padded name so the search for the tier digit doesn't
    // accidentally hit a "1" inside the provider name if the fixture changes.
    const tierColRow = visibleWidth(
      row!.slice(0, row!.indexOf("1", "brave".length)),
    );
    expect(tierColRow).toBe(tierColHeader);
  });
  it("renders the Test column empty for non-search providers", () => {
    const lines = dashboard({
      providerNames: ["brave", "duckduckgo", "exa"],
      tierMap: new Map<string, ProviderTier>([
        ["brave", 1],
        ["duckduckgo", 3],
        ["exa", 2],
      ]),
      config: {
        providers: {
          brave: { enabled: true, apiKey: "BRAVE_API_KEY", budget: { mode: "managed" as const } },
          duckduckgo: { enabled: false, apiKey: "BRAVE_API_KEY", budget: { mode: "unlimited" as const } },
          exa: { enabled: true, apiKey: "EXA_API_KEY", budget: { mode: "unlimited" as const } },
        },
        defaultProvider: "brave",
      },
    }).component.render(200);
    const exaLine = lines.find((line) => line.includes("exa"));
    expect(exaLine).toBeDefined();
    // Use word-boundary patterns so we don't match substrings inside other
    // text. The Test cell is empty for non-search providers that haven't
    // been tested.
    expect(exaLine).not.toMatch(/\bOK\b/);
    expect(exaLine).not.toMatch(/\bFAIL\b/);
    expect(exaLine).not.toContain("Testing");
  });

  it("marks non-search providers as 'not a search provider' when t is pressed", () => {
    const { component } = dashboard({
      providerNames: ["brave", "duckduckgo", "exa"],
      tierMap: new Map<string, ProviderTier>([
        ["brave", 1],
        ["duckduckgo", 3],
        ["exa", 2],
      ]),
      config: {
        providers: {
          brave: { enabled: true, apiKey: "BRAVE_API_KEY", budget: { mode: "managed" as const } },
          duckduckgo: { enabled: false, apiKey: "BRAVE_API_KEY", budget: { mode: "unlimited" as const } },
          exa: { enabled: true, apiKey: "EXA_API_KEY", budget: { mode: "unlimited" as const } },
        },
        defaultProvider: "brave",
      },
    });
    component.handleInput("[B");
    component.handleInput("[B");
    component.handleInput("t");
    const output = component.render(200).join("\n");
    expect(output).toMatch(/exa.*not a search provider/);
  });

  it("shows the selected search provider's test result inline after t", async () => {
    const { component, tui } = dashboard();
    component.handleInput("t");
    await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalledTimes(2));
    const output = component.render(200).join("\n");
    expect(output).toMatch(/brave.*OK.*1 result/);
  });

  it("shows each search provider's test result after T", async () => {
    const { component, tui } = dashboard();
    component.handleInput("T");
    await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalledTimes(2));
    const output = component.render(200).join("\n");
    expect(output).toMatch(/brave.*OK/);
    expect(output).toMatch(/duckduckgo.*OK/);
  });

  it("marks the selected row as Testing while the request is in flight", async () => {
    let resolveSearch!: (results: SearchResult[]) => void;
    const provider: SearchProvider = {
      name: "brave",
      label: "Brave",
      search: vi.fn(
        () => new Promise<SearchResult[]>((r) => (resolveSearch = r)),
      ),
    };
    const { component } = dashboard({
      registry: searchRegistry([provider]),
    });
    component.handleInput("t");
    expect(component.render(200).join("\n")).toContain("Testing…");
    resolveSearch([]);
    await eventLoopTurn();
    // After resolution, the in-flight indicator is gone and the OK result
    // is rendered for the selected row.
    expect(component.render(200).join("\n")).toContain("OK");
    expect(component.render(200).join("\n")).not.toContain("Testing…");
  });
  it("runs t and T on read-only scope without needing canWrite", async () => {
    const readOnly = dashboard({ scope: { kind: "project", path: "/repo/.pi/tools.json", canWrite: false } });
    readOnly.component.handleInput("t");
    await vi.waitFor(() => expect(readOnly.tui.requestRender).toHaveBeenCalledTimes(2));
    expect(readOnly.component.render(200).join("\n")).toMatch(/brave.*OK/);

    readOnly.component.handleInput("T");
    await vi.waitFor(() => expect(readOnly.tui.requestRender).toHaveBeenCalledTimes(4));
    expect(readOnly.component.render(200).join("\n")).toMatch(/duckduckgo.*OK/);
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

    for (let index = 0; index < 11; index += 1) component.handleInput("[B");
    const lines = component.render(80);
    const output = lines.join("\n");

    expect(output).toContain("provider-12");
    expect(output).toContain("Showing 3–12 of 12");
    expect(output).not.toContain("provider-1 ");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

})
