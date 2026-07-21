import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { PiToolsConfig } from "../config.ts";
import type { ActivityEntry } from "../monitor/activity-monitor.ts";
import { formatEntryLine } from "../monitor/widget.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import {
  type DashboardTheme,
  padVisible,
  truncateVisible,
  wrapVisible,
} from "../tui/dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "../tui/overlay-render.ts";
import {
  classifyCredential,
  runProviderTest,
  runProviderTests,
  type TestResult,
} from "./tools-actions.ts";

export type DashboardTabId = "providers" | "status" | "activity";

export interface DashboardResumeState {
  activeTab: DashboardTabId;
  selectedProvider?: string;
}

type ReopenDashboardAction =
  | { type: "reload" }
  | { type: "toggle-widget" }
  | { type: "toggle"; provider: string }
  | { type: "set-key"; provider: string }
  | { type: "set-default"; provider: string }
  | { type: "switch-scope" };

export type DashboardAction = (ReopenDashboardAction & DashboardResumeState) | { type: "close" };

export interface DashboardScope {
  kind: "global" | "project";
  path: string;
  canWrite: boolean;
}

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  registry: ProviderRegistry;
  providerNames: string[];
  tierMap: ReadonlyMap<string, ProviderTier>;
  config: Pick<PiToolsConfig, "providers" | "defaultProvider">;
  scope: DashboardScope;
  renderStatusTable: () => string;
  getActivity: () => readonly ActivityEntry[];
  subscribeActivity: (listener: () => void) => () => void;
  widgetEnabled: boolean;
  initialTab?: DashboardTabId;
  initialProvider?: string;
  done: (action: DashboardAction) => void;
}

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";

function visibleRange(index: number, total: number): { start: number; end: number } {
  const count = Math.min(10, total);
  const start = Math.max(0, Math.min(index - Math.floor(count / 2), total - count));
  return { start, end: start + count };
}

const ROW_INDICATOR = "\u25B8"; // right-pointing small triangle (U+25B8)
const ROW_PREFIX_WIDTH = 2; // width of the indicator column (incl. trailing space)

function renderRowPrefix(selected: boolean, theme: DashboardTheme): string {
  // Selected row carries the indicator; unselected rows use spaces to keep
  // the column width constant so the name column stays aligned with the
  // header. (Originally the row used `>` only on the selected row with empty
  // padding elsewhere; this restores that pattern with the new glyph.)
  if (!selected) return " ".repeat(ROW_PREFIX_WIDTH);
  return `${theme.fg("accent", ROW_INDICATOR)} `;
}

export class ToolsDashboardComponent implements Component {
  private activeTab: DashboardTabId;
  private providerIndex: number;
  private testController?: AbortController;
  private testResults = new Map<string, TestResult>();
  private activityUnsubscribe?: () => void;
  private disposed = false;

  constructor(private readonly options: DashboardOptions) {
    this.activeTab = options.initialTab ?? "providers";
    const initialIndex = options.initialProvider
      ? options.providerNames.indexOf(options.initialProvider)
      : -1;
    this.providerIndex = initialIndex >= 0 ? initialIndex : 0;
    this.activityUnsubscribe = options.subscribeActivity(() => {
      if (!this.disposed) options.tui.requestRender();
    });
  }

  render(width: number): string[] {
    const contentWidth = frameContentWidth(width);
    const content =
      this.activeTab === "providers"
        ? this.renderProviders(contentWidth)
        : this.activeTab === "status"
          ? this.renderStatus(contentWidth)
          : this.renderActivity(contentWidth);
    return frame(
      [
        renderTabBar(TABS, this.activeTab, contentWidth, this.options.theme),
        "",
        ...content,
        "",
        this.renderFooter(contentWidth),
      ],
      width,
      this.options.theme,
    );
  }

  handleInput(data: string): void {
    if (data === "q" || matchesKey(data, Key.escape)) {
      this.finish({ type: "close" });
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, SHIFT_TAB_KEY)) {
      this.switchTab(-1);
      return;
    }
    if (this.activeTab === "providers") {
      this.handleProviderInput(data);
      return;
    }
    if (this.activeTab === "status" && data === "r") {
      this.finish({ type: "reload", ...this.resume() });
      return;
    }
    if (this.activeTab === "activity" && data === "w") {
      this.finish({ type: "toggle-widget", ...this.resume() });
    }
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.testController?.abort();
    this.testController = undefined;
    const unsubscribe = this.activityUnsubscribe;
    this.activityUnsubscribe = undefined;
    unsubscribe?.();
  }

  private renderProviders(contentWidth: number): string[] {
    const { providerNames } = this.options;
    const scopeLabel = this.options.scope.kind === "global" ? "Global" : "Project";
    const readOnly = this.options.scope.canWrite ? "" : " (read-only)";
    const lines = [
      truncateVisible(`${scopeLabel}: ${this.options.scope.path}${readOnly}`, contentWidth),
      "",
      truncateVisible(
        `${padVisible("", 2)}${padVisible("Provider", 20)} ${padVisible("Tier", 4)} ${padVisible("State", 8)} ${padVisible("Key", 22)} ${padVisible("Budget", 12)} Default`,
        contentWidth,
      ),
    ];
    if (providerNames.length === 0) return [...lines, this.options.theme.dim("No providers")];

    const { start, end } = visibleRange(this.providerIndex, providerNames.length);

    for (let index = start; index < end; index += 1) {
      const name = providerNames[index];
      const entry = this.options.config.providers[name];
      const key = entry?.apiKey;
      const keyState =
        key === undefined
          ? "unset"
          : classifyCredential(key) === "env"
            ? `env: ${key}`
            : "set";
      const isSelected = index === this.providerIndex;
      const prefix = renderRowPrefix(isSelected, this.options.theme);
      const paddedName = padVisible(truncateVisible(name, 20), 20);
      const nameCell = isSelected
        ? this.options.theme.fg("accent", this.options.theme.bold(paddedName))
        : this.options.theme.dim(paddedName);
      const testCell = this.renderTestCell(name, isSelected);
      const rest =
        `${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ` +
        `${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ` +
        `${padVisible(truncateVisible(keyState, 22), 22)} ` +
        `${padVisible(entry?.budget.mode ?? "--", 12)} ` +
        `${this.options.config.defaultProvider === name ? "default" : ""}`;
      lines.push(
        truncateVisible(
          `${prefix}${nameCell} ${rest}${testCell ? ` ${testCell}` : ""}`,
          contentWidth,
        ),
      );
    }
    lines.push(`Showing ${start + 1}–${end} of ${providerNames.length}`);
    return lines;
  }

  private renderTestCell(name: string, isSelected: boolean): string {
    // "Testing…" takes precedence while a request is in flight for the
    // selected row. Show this regardless of whether the row is a search
    // provider — only the selected row can show it.
    if (isSelected && this.testController !== undefined) {
      return this.options.theme.dim("Testing…");
    }
    const result = this.testResults.get(name);
    if (!result) return "";
    // Non-search providers never show a successful test cell, but they can
    // still display a deterministic failure if `t` was pressed on them.
    const isSearchProvider =
      this.options.registry.selectSearchCandidates(name).length > 0;
    if (!isSearchProvider) {
      // Render the deterministic failure for non-search providers.
      return `FAIL • ${result.message}`;
    }
    if (result.ok) {
      const summary = `OK • ${result.latencyMs}ms`;
      return result.resultCount > 0
        ? `${summary} • ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}`
        : summary;
    }
    // Failure path: result.ok is false, so message is the diagnostic text.
    return `FAIL • ${result.latencyMs}ms • ${result.message}`;
  }

  private renderStatus(contentWidth: number): string[] {
    return this.options
      .renderStatusTable()
      .split("\n")
      .flatMap((line) => wrapVisible(line, contentWidth));
  }

  private renderActivity(contentWidth: number): string[] {
    const entries = this.options.getActivity().slice(-10);
    if (entries.length === 0) {
      return [this.options.theme.dim("No activity yet")];
    }
    return entries.map((entry) =>
      truncateVisible(formatEntryLine(entry, this.options.theme), contentWidth),
    );
  }

  private renderFooter(contentWidth: number): string {
    let action: string;
    if (this.activeTab === "providers") {
      const testBindings = "t Test • T Test all";
      action = this.options.scope.canWrite
        ? `Enter Toggle • k Set key • d Set default • a Auto default • ${testBindings} • ←/→ Scope`
        : `${testBindings} • ←/→ Scope`;
    } else if (this.activeTab === "status") {
      action = "r Reload";
    } else {
      action = `w ${this.options.widgetEnabled ? "Disable" : "Enable"} widget`;
    }
    return this.options.theme.dim(
      truncateVisible(`${action} • Tab/Shift-Tab Switch tab • q Close`, contentWidth),
    );
  }

  private handleProviderInput(data: string): void {
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      this.finish({ type: "switch-scope", ...this.resume() });
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const delta = matchesKey(data, Key.up) ? -1 : 1;
      this.providerIndex = Math.max(
        0,
        Math.min(this.providerIndex + delta, this.options.providerNames.length - 1),
      );
      this.options.tui.requestRender();
      return;
    }

    // Test bindings work on read-only scope too — testing is non-mutating.
    // Place these above the canWrite guard so they fire even when scope.canWrite is false.
    if (data === "t") {
      const name = this.options.providerNames[this.providerIndex];
      if (!name) return;
      const candidates = this.options.registry.selectSearchCandidates(name);
      if (candidates.length === 0) {
        this.testResults.set(name, {
          provider: name,
          ok: false,
          latencyMs: 0,
          resultCount: 0,
          message: "not a search provider",
        });
        this.options.tui.requestRender();
        return;
      }
      this.beginTest(async (signal) => [
        await runProviderTest(name, this.options.registry, signal),
      ]);
      return;
    }

    if (matchesKey(data, Key.shift("t"))) {
      const searchNames = this.options.registry.getSearchProviderNames();
      if (searchNames.length === 0) return;
      this.beginTest((signal) =>
        runProviderTests(this.options.registry, searchNames, signal),
      );
      return;
    }

    if (!this.options.scope.canWrite) return;
    const provider = this.options.providerNames[this.providerIndex];
    if (!provider) return;

    if (matchesKey(data, Key.enter)) {
      this.finish({ type: "toggle", provider, ...this.resume() });
    } else if (data === "k") {
      this.finish({ type: "set-key", provider, ...this.resume() });
    } else if (data === "d") {
      this.finish({ type: "set-default", provider, ...this.resume() });
    } else if (data === "a") {
      this.finish({ type: "set-default", provider: "auto", ...this.resume() });
    }
  }

  private beginTest(run: (signal: AbortSignal) => Promise<TestResult[]>): void {
    if (this.disposed) return;
    this.testController?.abort();
    const controller = new AbortController();
    this.testController = controller;
    this.options.tui.requestRender();
    void run(controller.signal).then((results) => {
      if (this.disposed || this.testController !== controller) return;
      for (const result of results) {
        this.testResults.set(result.provider, result);
      }
      this.testController = undefined;
      this.options.tui.requestRender();
    });
  }

  private resume(): DashboardResumeState {
    return {
      activeTab: this.activeTab,
      selectedProvider: this.options.providerNames[this.providerIndex],
    };
  }

  private switchTab(delta: number): void {
    const index = TABS.findIndex((tab) => tab.id === this.activeTab);
    this.activeTab = TABS[(index + delta + TABS.length) % TABS.length].id as DashboardTabId;
    this.options.tui.requestRender();
  }

  private finish(action: DashboardAction): void {
    if (this.disposed) return;
    this.dispose();
    this.options.done(action);
  }
}
