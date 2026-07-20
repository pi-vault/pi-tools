import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { ActivityEntry } from "../monitor/activity-monitor.ts";
import { formatEntryLine } from "../monitor/widget.ts";
import { type DashboardTheme, truncateVisible, wrapVisible } from "../tui/dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "../tui/overlay-render.ts";

export type DashboardTabId = "status" | "activity";

export type DashboardAction =
  | { type: "reload"; activeTab: DashboardTabId }
  | { type: "toggle-widget"; activeTab: DashboardTabId }
  | { type: "close" };

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  renderStatusTable: () => string;
  getActivity: () => readonly ActivityEntry[];
  subscribeActivity: (listener: () => void) => () => void;
  widgetEnabled: boolean;
  initialTab?: DashboardTabId;
  done: (action: DashboardAction) => void;
}

const TABS = [
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";

export class ToolsDashboardComponent implements Component {
  private activeTab: DashboardTabId;
  private activityUnsubscribe?: () => void;
  private disposed = false;

  constructor(private readonly options: DashboardOptions) {
    this.activeTab = options.initialTab ?? "status";
    this.activityUnsubscribe = options.subscribeActivity(() => {
      if (!this.disposed) options.tui.requestRender();
    });
  }

  render(width: number): string[] {
    const contentWidth = frameContentWidth(width);
    const content =
      this.activeTab === "status"
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
    if (this.activeTab === "status" && data === "r") {
      this.finish({ type: "reload", activeTab: this.activeTab });
      return;
    }
    if (this.activeTab === "activity" && data === "w") {
      this.finish({ type: "toggle-widget", activeTab: this.activeTab });
    }
  }

  invalidate(): void {}

  dispose(): void {
    const unsubscribe = this.activityUnsubscribe;
    this.activityUnsubscribe = undefined;
    unsubscribe?.();
    this.disposed = true;
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
    const action =
      this.activeTab === "status"
        ? "r Reload"
        : `w ${this.options.widgetEnabled ? "Disable" : "Enable"} widget`;
    return this.options.theme.dim(
      truncateVisible(`${action} • Tab/Shift-Tab Switch tab • q Close`, contentWidth),
    );
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
