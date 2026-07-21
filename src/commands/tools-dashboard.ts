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

export type DashboardTabId = "providers" | "status" | "test" | "activity";

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
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";

function visibleRange(index: number, total: number): { start: number; end: number } {
  const count = Math.min(10, total);
  const start = Math.max(0, Math.min(index - Math.floor(count / 2), total - count));
  return { start, end: start + count };
}

export class ToolsDashboardComponent implements Component {
  private activeTab: DashboardTabId;
  private providerIndex: number;
  private testIndex: number;
  private testController?: AbortController;
  private testResults: TestResult[] = [];
  private activityUnsubscribe?: () => void;
  private disposed = false;

  constructor(private readonly options: DashboardOptions) {
    this.activeTab = options.initialTab ?? "providers";
    const initialIndex = options.initialProvider
      ? options.providerNames.indexOf(options.initialProvider)
      : -1;
    this.providerIndex = initialIndex >= 0 ? initialIndex : 0;
    const searchNames = options.registry.getSearchProviderNames();
    const initialTestIndex = options.initialProvider
      ? searchNames.indexOf(options.initialProvider)
      : -1;
    this.testIndex = initialTestIndex >= 0 ? initialTestIndex : 0;
    this.activityUnsubscribe = options.subscribeActivity(() => {
      if (!this.disposed) options.tui.requestRender();
    });
  }

  render(width: number): string[] {
    const contentWidth = frameContentWidth(width);
    const content =
      this.activeTab === "providers"
        ? this.renderProviders(contentWidth)
        : this.activeTab === "test"
          ? this.renderTest(contentWidth)
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
    if (this.activeTab === "test") {
      this.handleTestInput(data);
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
        key === undefined ? "unset" : classifyCredential(key) === "env" ? `env: ${key}` : "set";
      const row = truncateVisible(
        `${padVisible(index === this.providerIndex ? ">" : "", 2)}${padVisible(truncateVisible(name, 20), 20)} ${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ${padVisible(truncateVisible(keyState, 22), 22)} ${padVisible(entry?.budget.mode ?? "--", 12)} ${this.options.config.defaultProvider === name ? "default" : ""}`,
        contentWidth,
      );
      lines.push(index === this.providerIndex ? this.options.theme.inverse(row) : row);
    }
    lines.push(`Showing ${start + 1}–${end} of ${providerNames.length}`);
    return lines;
  }

  private renderStatus(contentWidth: number): string[] {
    return this.options
      .renderStatusTable()
      .split("\n")
      .flatMap((line) => wrapVisible(line, contentWidth));
  }

  private renderTest(contentWidth: number): string[] {
    const names = this.options.registry.getSearchProviderNames();
    const lines = [
      truncateVisible(this.testController ? "Testing…" : "Enter/t Test • a Test all", contentWidth),
      "",
    ];
    if (names.length === 0) {
      return [...lines, this.options.theme.dim("No enabled search providers")];
    }

    const results = new Map(this.testResults.map((result) => [result.provider, result]));
    const { start, end } = visibleRange(this.testIndex, names.length);
    for (let index = start; index < end; index += 1) {
      const name = names[index];
      const result = results.get(name);
      const detail = result
        ? `${result.ok ? "OK" : "FAIL"} • ${result.latencyMs}ms • ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}${result.message === "OK" ? "" : ` • ${result.message}`}`
        : "";
      const row = truncateVisible(
        `${padVisible(index === this.testIndex ? ">" : "", 2)}${padVisible(truncateVisible(name, 20), 20)} ${detail}`,
        contentWidth,
      );
      lines.push(index === this.testIndex ? this.options.theme.inverse(row) : row);
    }
    lines.push(truncateVisible(`Showing ${start + 1}–${end} of ${names.length}`, contentWidth));
    return lines;
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
      action = this.options.scope.canWrite
        ? "Enter Toggle • k Set key • d Set default • a Auto default • ←/→ Scope"
        : "←/→ Scope";
    } else if (this.activeTab === "status") {
      action = "r Reload";
    } else if (this.activeTab === "test") {
      action = "Enter/t Test • a Test all";
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

  private handleTestInput(data: string): void {
    const names = this.options.registry.getSearchProviderNames();
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const delta = matchesKey(data, Key.up) ? -1 : 1;
      this.testIndex = Math.max(0, Math.min(this.testIndex + delta, names.length - 1));
      this.options.tui.requestRender();
    } else if (matchesKey(data, Key.enter) || data === "t") {
      this.testSelected();
    } else if (data === "a") {
      this.testAll();
    }
  }

  private testSelected(): void {
    const name = this.options.registry.getSearchProviderNames()[this.testIndex];
    if (!name) return;
    this.beginTest(async (signal) => [await runProviderTest(name, this.options.registry, signal)]);
  }

  private testAll(): void {
    const names = this.options.registry.getSearchProviderNames();
    if (names.length === 0) return;
    this.beginTest((signal) => runProviderTests(this.options.registry, names, signal));
  }

  private beginTest(run: (signal: AbortSignal) => Promise<TestResult[]>): void {
    if (this.disposed) return;
    this.testController?.abort();
    const controller = new AbortController();
    this.testController = controller;
    this.testResults = [];
    this.options.tui.requestRender();
    void run(controller.signal).then((results) => {
      if (this.disposed || this.testController !== controller) return;
      this.testResults = results;
      this.testController = undefined;
      this.options.tui.requestRender();
    });
  }

  private resume(): DashboardResumeState {
    const names =
      this.activeTab === "test"
        ? this.options.registry.getSearchProviderNames()
        : this.options.providerNames;
    const index = this.activeTab === "test" ? this.testIndex : this.providerIndex;
    return {
      activeTab: this.activeTab,
      selectedProvider: names[index],
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
