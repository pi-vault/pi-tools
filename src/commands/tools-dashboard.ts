import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { DashboardTheme } from "../tui/dashboard-theme.ts";
import { wrapVisible } from "../tui/dashboard-theme.ts";
import { frame, frameContentWidth, renderTabBar } from "../tui/overlay-render.ts";

export type DashboardAction = { type: "reload" } | { type: "close" };

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  renderStatusTable: () => string;
  done: (action: DashboardAction) => void;
}

const TABS = [{ id: "status", label: "Status" }] as const;

export class ToolsDashboardComponent implements Component {
  private disposed = false;

  constructor(private readonly options: DashboardOptions) {}

  render(width: number): string[] {
    const contentWidth = frameContentWidth(width);
    const status = this.options
      .renderStatusTable()
      .split("\n")
      .flatMap((line) => wrapVisible(line, contentWidth));
    return frame(
      [
        renderTabBar([...TABS], "status", contentWidth, this.options.theme),
        "",
        ...status,
        "",
        this.options.theme.dim("r Reload • q Close"),
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
    if (data === "r") this.finish({ type: "reload" });
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
  }

  private finish(action: DashboardAction): void {
    if (this.disposed) return;
    this.dispose();
    this.options.done(action);
  }
}
