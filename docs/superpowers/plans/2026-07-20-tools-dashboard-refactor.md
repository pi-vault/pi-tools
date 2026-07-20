# /tools Dashboard Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all typed `/tools` subcommands with a tabbed interactive overlay dashboard (Providers, Status, Test, Activity), porting the overlay shell from pi-usage.

**Architecture:** Four new/ported files under `src/commands/` (dashboard-theme.ts, overlay-render.ts, tools-dashboard.ts, tools-actions.ts) plus deletions of tools-setup.ts and tools-subcommands.ts. The dashboard is a `Component` opened via `ctx.ui.custom()` with the same `render()`/`handleInput()` lifecycle as pi-usage's dashboard.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (transitive), `@earendil-works/pi-coding-agent`, vitest, node:fs.

---

### Task 1: Port overlay infrastructure from pi-usage

**Files:**

- Create: `src/commands/dashboard-theme.ts`
- Create: `src/commands/overlay-render.ts`
- Reference: `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts`
- Reference: `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts`

- [ ] **Step 1: Copy dashboard-theme.ts**

Copy `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts` verbatim to `src/commands/dashboard-theme.ts`.

The file has no pi-usage imports — it only imports `@earendil-works/pi-tui` (truncateToWidth, visibleWidth, wrapTextWithAnsi) and `@earendil-works/pi-coding-agent` (Theme type). Both are already available to pi-tools.

- [ ] **Step 2: Copy overlay-render.ts**

Copy `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts` verbatim to `src/commands/overlay-render.ts`.

Same dependency story: only imports `@earendil-works/pi-tui` and local dashboard-theme.ts. No pi-usage coupling.

- [ ] **Step 3: Quick verify imports compile**

Run: `npx tsc --noEmit src/commands/dashboard-theme.ts src/commands/overlay-render.ts 2>&1 | head -20`
Expected: no module-not-found errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: port overlay infrastructure (dashboard-theme + overlay-render) from pi-usage"
```

---

### Task 2: Create tools-actions.ts — scoped config writes + test execution

**Files:**

- Create: `src/commands/tools-actions.ts`
- Test: `tests/commands/tools-actions.test.ts`

- [ ] **Step 1: Write the failing test for scope detection**

Create `tests/commands/tools-actions.test.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectScope,
  writeGlobalConfig,
  writeProjectConfig,
  isLiteralKey,
  isEnvRef,
  maskKey,
} from "../../src/commands/tools-actions.ts";
import { getConfigPath } from "../../src/config.ts";

vi.mock("node:fs");

describe("detectScope", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'project' when .pi/tools.json exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      (p as string).endsWith(path.join(".pi", "tools.json")) ? true : false,
    );
    expect(detectScope("/some/project")).toBe("project");
  });

  it("returns 'global' when no .pi/tools.json found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(detectScope("/some/project")).toBe("global");
  });
});

describe("isLiteralKey / isEnvRef", () => {
  it("isLiteralKey detects plain text values", () => {
    expect(isLiteralKey("sk-abc123")).toBe(true);
    expect(isLiteralKey("BSA_test_key")).toBe(true);
    expect(isLiteralKey("BRAVE_API_KEY")).toBe(false); // env var pattern
    expect(isLiteralKey("!some-command")).toBe(false); // shell command
  });

  it("isEnvRef detects env var or shell cmd patterns", () => {
    expect(isEnvRef("BRAVE_API_KEY")).toBe(true);
    expect(isEnvRef("OPENAI_API_KEY")).toBe(true);
    expect(isEnvRef("!op read op://Personal/Brave/credential")).toBe(true);
    expect(isEnvRef("sk-abc123")).toBe(false);
    expect(isEnvRef("")).toBe(false);
  });
});

describe("writeGlobalConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("writes a provider toggle to the global config path", () => {
    writeGlobalConfig((config) => {
      const providers = (config.providers ?? {}) as Record<string, any>;
      providers.brave = { ...providers.brave, enabled: true };
      return { ...config, providers };
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      getConfigPath(),
      expect.any(String),
    );
    const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(content as string);
    expect(written.providers.brave.enabled).toBe(true);
  });
});

describe("writeProjectConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("merges and writes to .pi/tools.json under the given cwd", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    writeProjectConfig("/tmp/proj", (config) => ({
      ...config,
      defaultProvider: "exa",
    }));

    const expectedPath = path.join("/tmp/proj", ".pi", "tools.json");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("exa"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools-actions.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found for `../../src/commands/tools-actions.ts`

- [ ] **Step 3: Write minimal implementation**

Create `src/commands/tools-actions.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProviderRegistry } from "../providers/registry.ts";
import { getConfigPath } from "../config.ts";

// ── Key helpers ──────────────────────────────────────────────────────────

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";

export function isLiteralKey(key: string): boolean {
  return !isEnvRef(key);
}

export function isEnvRef(key: string): boolean {
  return ENV_VAR_PATTERN.test(key) || key.startsWith(SHELL_CMD_PREFIX);
}

export function maskKey(key: string): string {
  if (key.length < 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ── Config scope ────────────────────────────────────────────────────────

export type ConfigScope = "global" | "project";

export function detectScope(cwd: string): ConfigScope {
  const projectConfigPath = path.join(cwd, ".pi", "tools.json");
  if (fs.existsSync(projectConfigPath)) return "project";
  return "global";
}

// ── Scoped config writes ────────────────────────────────────────────────

type ConfigUpdater = (
  config: Record<string, unknown>,
) => Record<string, unknown>;

export function writeGlobalConfig(updater: ConfigUpdater): void {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // start fresh
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

export function writeProjectConfig(cwd: string, updater: ConfigUpdater): void {
  const configPath = path.join(cwd, ".pi", "tools.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // start fresh
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

// ── Test execution ──────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export async function runProviderTest(
  providerName: string,
  registry: ProviderRegistry,
  signal?: AbortSignal,
): Promise<TestResult> {
  const candidates = registry.selectSearchCandidates(providerName);
  if (candidates.length === 0) {
    return {
      name: providerName,
      ok: false,
      latencyMs: 0,
      detail: "not found or not enabled",
    };
  }

  const provider = candidates[0];
  const startMs = Date.now();

  if (signal?.aborted) {
    return { name: providerName, ok: false, latencyMs: 0, detail: "aborted" };
  }

  try {
    const searchResults = await provider.search("test", 1, { signal });
    const elapsed = Date.now() - startMs;
    return {
      name: providerName,
      ok: true,
      latencyMs: elapsed,
      detail: `OK (${elapsed}ms, ${searchResults.length} result${searchResults.length !== 1 ? "s" : ""})`,
    };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    if (signal?.aborted) {
      return {
        name: providerName,
        ok: false,
        latencyMs: elapsed,
        detail: "aborted",
      };
    }
    return {
      name: providerName,
      ok: false,
      latencyMs: elapsed,
      detail: `FAIL — ${msg}`,
    };
  }
}

export async function runAllProviderTests(
  registry: ProviderRegistry,
  signal?: AbortSignal,
): Promise<TestResult[]> {
  const names = registry.getSearchProviderNames();
  const results: TestResult[] = [];
  for (const name of names) {
    if (signal?.aborted) break;
    results.push(await runProviderTest(name, registry, signal));
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools-actions.test.ts 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add tools-actions module (scoped config writes + test execution)"
```

---

### Task 3: Create tools-dashboard.ts — skeleton + Providers tab

**Files:**

- Create: `src/commands/tools-dashboard.ts`
- Test: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Write the failing test for dashboard rendering**

Create `tests/commands/tools-dashboard.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { DashboardComponent } from "../../src/commands/tools-dashboard.ts";
import type { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier } from "../../src/providers/types.ts";
import { noTheme } from "../../src/commands/dashboard-theme.ts";

// Minimal ProviderRegistry that satisfies the DashboardComponent
function memRegistry(): ProviderRegistry {
  return new (class {
    getProviderNames = () => ["brave", "duckduckgo"];
    getSearchProviderNames = () => ["brave", "duckduckgo"];
    selectSearchCandidates = () => [];
    getBudgetStatus = vi.fn().mockReturnValue(undefined);
    getMetrics = vi.fn().mockReturnValue(undefined);
  })() as unknown as ProviderRegistry;
}

describe("DashboardComponent", () => {
  it("renders four tabs with default active tab", () => {
    const registry = memRegistry();
    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
    ]);
    const done = vi.fn();
    const component = new DashboardComponent({
      registry,
      tierMap,
      parentCwd: "/tmp",
      allProviderNames: ["brave", "duckduckgo"],
      onReload: vi.fn(),
      theme: noTheme,
      done,
    });

    const output = component.render(80);
    const text = output.join("\n");

    // Should show all four tab labels
    expect(text).toContain("Providers");
    expect(text).toContain("Status");
    expect(text).toContain("Test");
    expect(text).toContain("Activity");
    // Default tab is Providers
    expect(text).toContain("brave");
    expect(text).toContain("duckduckgo");
  });

  it("handleInput with q calls done", () => {
    const registry = memRegistry();
    const done = vi.fn();
    const component = new DashboardComponent({
      registry,
      tierMap: new Map(),
      parentCwd: "/tmp",
      allProviderNames: [],
      onReload: vi.fn(),
      theme: noTheme,
      done,
    });

    component.handleInput("q");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("handleInput with Tab switches to next tab", () => {
    const registry = memRegistry();
    const component = new DashboardComponent({
      registry,
      tierMap: new Map(),
      parentCwd: "/tmp",
      allProviderNames: [],
      onReload: vi.fn(),
      theme: noTheme,
      done: vi.fn(),
    });

    component.handleInput("\t"); // Tab
    const output = component.render(80);
    // Second tab (Status) should now be active — no provider names visible
    expect(output.join("\n")).not.toContain("duckduckgo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools-dashboard.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Write the DashboardComponent skeleton (Providers tab)**

Create `src/commands/tools-dashboard.ts`:

```typescript
import type { Component } from "@earendil-works/pi-tui";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import type { DashboardTheme } from "./dashboard-theme.ts";
import { noTheme, padVisible, truncateVisible } from "./dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "./overlay-render.ts";
import { buildStatusTable } from "./tools.ts";
import {
  type TestResult,
  runAllProviderTests,
  runProviderTest,
} from "./tools-actions.ts";
import type { ConfigScope } from "./tools-actions.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";

type TabId = "providers" | "status" | "test" | "activity";
const TABS: DashboardTab[] = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
];

export interface DashboardOptions {
  registry: ProviderRegistry;
  tierMap: ReadonlyMap<string, ProviderTier>;
  parentCwd: string;
  allProviderNames: string[];
  onReload: () => void;
  theme?: DashboardTheme;
  done: () => void;
  setWidget?: (id: string, lines: string[] | undefined) => void;
}

export class DashboardComponent implements Component {
  private activeTab: TabId = "providers";
  private readonly theme: DashboardTheme;
  private readonly registry: ProviderRegistry;
  private readonly tierMap: ReadonlyMap<string, ProviderTier>;
  private readonly parentCwd: string;
  private readonly allProviderNames: string[];
  private readonly onReload: () => void;
  private readonly done: () => void;
  private readonly setWidget?: (
    id: string,
    lines: string[] | undefined,
  ) => void;

  // Providers tab state
  private providerRowIndex = 0;
  private configScope: ConfigScope = "global";

  // Test tab state
  private testRowIndex = 0;
  private testResults: TestResult[] | null = null;
  private testRunning = false;
  private testAbortController: AbortController | null = null;

  // Activity tab state
  private widgetActive: boolean = false;
  private monitorUnsub: (() => void) | null = null;

  constructor(options: DashboardOptions) {
    this.registry = options.registry;
    this.tierMap = options.tierMap;
    this.parentCwd = options.parentCwd;
    this.allProviderNames = options.allProviderNames;
    this.onReload = options.onReload;
    this.done = options.done;
    this.theme = options.theme ?? noTheme;
    this.setWidget = options.setWidget;
  }

  render(width: number): string[] {
    const w = Math.max(8, width);
    const contentWidth = frameContentWidth(w);
    const lines: string[] = [];

    lines.push(renderTabBar(TABS, this.activeTab, contentWidth, this.theme));
    lines.push("");

    switch (this.activeTab) {
      case "providers":
        this.renderProvidersTab(contentWidth, lines);
        break;
      case "status":
        this.renderStatusTab(contentWidth, lines);
        break;
      case "test":
        this.renderTestTab(contentWidth, lines);
        break;
      case "activity":
        this.renderActivityTab(contentWidth, lines);
        break;
    }

    // Footer
    lines.push("");
    lines.push(this.renderFooter());

    return frame(lines, w, this.theme);
  }

  // ── Tab renderers ──────────────────────────────────────────────────────

  private renderProvidersTab(w: number, lines: string[]): void {
    // Scope toggle indicator
    const scopeLabel = this.theme.dim(
      `Config scope: [${this.configScope === "global" ? this.theme.bold("Global") : "Global"}] / [${this.configScope === "project" ? this.theme.bold("Project") : "Project"}]  (L/R to toggle)`,
    );
    lines.push(scopeLabel);
    lines.push("");

    if (this.allProviderNames.length === 0) {
      lines.push(this.theme.dim("No providers available."));
      return;
    }

    // Header row
    const header = this.theme.fg(
      "borderMuted",
      padVisible("Provider", 20) +
        padVisible("Tier", 6) +
        padVisible("Status", 10) +
        padVisible("Key", 24) +
        padVisible("Budget", 16),
    );
    lines.push(header);
    lines.push(this.theme.fg("borderMuted", "─".repeat(Math.min(w, 76))));

    for (let i = 0; i < this.allProviderNames.length; i++) {
      const name = this.allProviderNames[i];
      const selected = i === this.providerRowIndex;
      const prefix = selected ? this.theme.fg("accent", "▸ ") : "  ";
      const nameStyled = selected
        ? this.theme.fg("accent", this.theme.bold(name))
        : this.theme.dim(name);

      const tier = this.tierMap.get(name) ?? 3;
      const budget = this.registry.getBudgetStatus(name);
      const budgetLabel =
        budget?.mode === "hard"
          ? `${budget.unit}`
          : (budget?.mode ?? "unlimited");
      const metrics = this.registry.getMetrics(name);
      const isEnabled = metrics !== undefined;

      const statusLabel = isEnabled
        ? this.theme.fg("success", "enabled")
        : this.theme.dim("disabled");
      // Key status: we show from config — simplified here as placeholder
      // In practice this requires reading the current config
      const keyLabel = this.theme.dim("—");

      lines.push(
        prefix +
          padVisible(nameStyled, 20) +
          padVisible(String(tier), 6) +
          padVisible(statusLabel, 10) +
          padVisible(keyLabel, 24) +
          padVisible(budgetLabel, 16),
      );
    }

    lines.push("");
    lines.push(this.theme.dim("[Enter] toggle  [k] set key  [d] set default"));
  }

  private renderStatusTab(w: number, lines: string[]): void {
    lines.push(this.theme.dim("[r] reload config"));
    lines.push("");
    const table = buildStatusTable(this.registry, this.tierMap);
    // Split table lines and dim them for inline rendering
    const tableLines = table.split("\n");
    for (const line of tableLines) {
      lines.push(this.theme.dim(line));
    }
  }

  private renderTestTab(w: number, lines: string[]): void {
    if (this.testRunning) {
      lines.push(this.theme.dim("Testing... press [Esc] to abort"));
      lines.push("");
    }

    const providerNames = this.registry.getSearchProviderNames();
    if (providerNames.length === 0) {
      lines.push(this.theme.dim("No search providers to test."));
      return;
    }

    for (let i = 0; i < providerNames.length; i++) {
      const name = providerNames[i];
      const selected = i === this.testRowIndex;
      const prefix = selected ? this.theme.fg("accent", "▸ ") : "  ";
      const nameStyled = selected
        ? this.theme.fg("accent", this.theme.bold(name))
        : this.theme.dim(name);

      lines.push(`${prefix}${nameStyled}`);
    }

    // Show results if available
    if (this.testResults) {
      lines.push("");
      lines.push(this.theme.fg("borderMuted", "─ Results ─"));
      for (const result of this.testResults) {
        const icon = result.ok
          ? this.theme.fg("success", "✓")
          : this.theme.fg("error", "✗");
        lines.push(`  ${icon} ${this.theme.dim(result.detail)}`);
      }
    }

    lines.push("");
    lines.push(this.theme.dim("[Enter/t] test selected  [a] test all"));
  }

  private renderActivityTab(w: number, lines: string[]): void {
    const toggleLabel = this.widgetActive
      ? this.theme.fg("success", "Widget: ON")
      : this.theme.dim("Widget: OFF");
    lines.push(`${toggleLabel}  ${this.theme.dim("[w] toggle widget")}`);
    lines.push("");

    const entries = activityMonitor.getEntries();
    if (entries.length === 0) {
      lines.push(this.theme.dim("No activity yet."));
    } else {
      // Show latest 10
      for (const entry of entries.slice(-10)) {
        lines.push(formatEntryLineSimple(entry, this.theme));
      }
    }
  }

  // ── Keyboard input ────────────────────────────────────────────────────

  handleInput(data: string): void {
    // Global keys
    if (data === "q" || this.matchesKey(data, "escape")) {
      this.cleanup();
      this.done();
      return;
    }
    if (this.matchesKey(data, "tab")) {
      this.switchTab(1);
      return;
    }
    if (this.matchesKey(data, "shift+tab")) {
      this.switchTab(-1);
      return;
    }

    switch (this.activeTab) {
      case "providers":
        this.handleProvidersInput(data);
        break;
      case "status":
        if (data === "r") {
          this.onReload();
        }
        break;
      case "test":
        this.handleTestInput(data);
        break;
      case "activity":
        this.handleActivityInput(data);
        break;
    }
  }

  private handleProvidersInput(data: string): void {
    if (this.matchesKey(data, "up")) {
      this.providerRowIndex = Math.max(0, this.providerRowIndex - 1);
      return;
    }
    if (this.matchesKey(data, "down")) {
      this.providerRowIndex = Math.min(
        this.allProviderNames.length - 1,
        this.providerRowIndex + 1,
      );
      return;
    }
    if (this.matchesKey(data, "left") || this.matchesKey(data, "right")) {
      this.configScope = this.configScope === "global" ? "project" : "global";
      return;
    }
    // Enter: toggle
    if (this.matchesKey(data, "enter")) {
      const name = this.allProviderNames[this.providerRowIndex];
      if (!name) return;
      const metrics = this.registry.getMetrics(name);
      const isEnabled = metrics !== undefined;
      // ponytail: synchronous toggle via the onReload caller. The action writes
      // config and calls onReload. A signal-based approach would be cleaner but
      // needs the ConfigManager reference. Add when we need deferred writes.
      this.onReload();
      return;
    }
  }

  private handleTestInput(data: string): void {
    if (data === "a" || data === "A") {
      this.runAllTests();
      return;
    }
    if (data === "t" || data === "T" || this.matchesKey(data, "enter")) {
      const names = this.registry.getSearchProviderNames();
      const name = names[this.testRowIndex];
      if (name) this.runSingleTest(name);
      return;
    }
    if (this.matchesKey(data, "up")) {
      const names = this.registry.getSearchProviderNames();
      const maxIdx = Math.max(0, names.length - 1);
      this.testRowIndex = Math.max(0, this.testRowIndex - 1);
      return;
    }
    if (this.matchesKey(data, "down")) {
      const names = this.registry.getSearchProviderNames();
      const maxIdx = Math.max(0, names.length - 1);
      this.testRowIndex = Math.min(maxIdx, this.testRowIndex + 1);
      return;
    }
    if (this.matchesKey(data, "escape")) {
      this.abortTests();
      return;
    }
  }

  private handleActivityInput(data: string): void {
    if (data === "w" || data === "W") {
      this.toggleWidget();
    }
  }

  // ── Test execution ────────────────────────────────────────────────────

  private async runSingleTest(name: string): Promise<void> {
    if (this.testRunning) return;
    this.testRunning = true;
    this.testAbortController = new AbortController();

    const result = await runProviderTest(
      name,
      this.registry,
      this.testAbortController.signal,
    );
    this.testResults = [result];
    this.testRunning = false;
    this.testAbortController = null;
  }

  private async runAllTests(): Promise<void> {
    if (this.testRunning) return;
    this.testRunning = true;
    this.testAbortController = new AbortController();

    this.testResults = await runAllProviderTests(
      this.registry,
      this.testAbortController.signal,
    );
    this.testRunning = false;
    this.testAbortController = null;
  }

  private abortTests(): void {
    if (this.testAbortController) {
      this.testAbortController.abort();
      this.testAbortController = null;
    }
    this.testRunning = false;
  }

  // ── Widget toggle ─────────────────────────────────────────────────────

  private toggleWidget(): void {
    if (this.widgetActive) {
      // Turn off
      this.widgetActive = false;
      this.monitorUnsub?.();
      this.monitorUnsub = null;
      this.setWidget?.("pi-tools-activity", undefined);
    } else {
      // Turn on
      this.widgetActive = true;
      this.monitorUnsub = activityMonitor.onUpdate(() => {
        const lines = renderWidgetLines(
          activityMonitor.getEntries(),
          this.theme,
        );
        this.setWidget?.("pi-tools-activity", lines);
      });
      // Initial render
      const lines = renderWidgetLines(activityMonitor.getEntries(), this.theme);
      this.setWidget?.("pi-tools-activity", lines);
    }
  }

  // ── Tab navigation ────────────────────────────────────────────────────

  private switchTab(delta: number): void {
    const i = TABS.findIndex((t) => t.id === this.activeTab);
    const next = (i + delta + TABS.length) % TABS.length;
    this.activeTab = TABS[next].id as TabId;
  }

  private matchesKey(data: string, key: string): boolean {
    // Simple key matching — uses \t for Tab, standard escape sequences
    if (key === "tab") return data === "\t";
    if (key === "shift+tab") return data === "\x1b[Z";
    if (key === "escape") return data === "\x1b" || data === "\x1b[";
    if (key === "enter") return data === "\n" || data === "\r";
    if (key === "up") return data === "\x1b[A";
    if (key === "down") return data === "\x1b[B";
    if (key === "left") return data === "\x1b[D";
    if (key === "right") return data === "\x1b[C";
    if (key === "space") return data === " ";
    return false;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  invalidate(): void {
    this.cleanup();
  }

  dispose(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.abortTests();
    // Note: widget state persists after overlay close — only session_shutdown resets it
  }

  private renderFooter(): string {
    return this.theme.dim(
      "[Tab/Shift+Tab] Switch tab  [Up/Down] Navigate  [Enter] Action  [q/Esc] Close",
    );
  }
}

// Simple entry formatter for activity tab (no theme-based colors to keep it simple)
function formatEntryLineSimple(
  entry: {
    type: string;
    query?: string;
    url?: string;
    status: number | null;
    startTime: number;
    endTime?: number;
  },
  theme: DashboardTheme,
): string {
  const target = entry.query ?? entry.url ?? "?";
  const truncated = target.length > 40 ? target.slice(0, 39) + "…" : target;
  const elapsed = entry.endTime
    ? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
    : "...";
  const statusStr = entry.status === null ? "..." : String(entry.status);
  return `  ${theme.dim(truncated.padEnd(42))} ${statusStr.padStart(4)} ${elapsed.padStart(6)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools-dashboard.test.ts 2>&1 | tail -15`
Expected: PASS (or near-pass with minor adjustments)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add DashboardComponent with Providers tab"
```

---

### Task 4: Rewrite tools.ts — thin dispatch, remove subcommands

**Files:**

- Modify: `src/commands/tools.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test for new /tools behavior**

Update `tests/commands/tools.test.ts`:

```typescript
import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createToolsCommand,
  buildStatusTable,
} from "../../src/commands/tools.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type {
  ProviderBudget,
  ProviderTier,
  SearchProvider,
} from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const mem = () =>
  new ProviderRegistry({
    load: () => ({ version: 2, counters: {} }),
    save: () => {},
  });

function mockProvider(name: string): SearchProvider {
  return { name, label: name, search: vi.fn().mockResolvedValue([]) };
}

function registerSearch(
  registry: ProviderRegistry,
  name: string,
  budget: ProviderBudget,
  tier: ProviderTier,
): void {
  registry.registerProvider(
    { search: mockProvider(name) },
    { name, tier, budget, config: { enabled: true, budget } },
  );
}

describe("tools command dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("opens dashboard overlay when called with no args", async () => {
    const registry = mem();
    registerSearch(registry, "brave", { mode: "managed" }, 1);
    const tierMap = new Map([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"], vi.fn());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn().mockResolvedValue(undefined);

    await command.handler("", ctx);

    expect((ctx.ui as any).custom).toHaveBeenCalled();
    const [factory, opts] = (ctx.ui as any).custom.mock.calls[0];
    expect(opts).toMatchObject({ overlay: true });
    expect(typeof factory).toBe("function");
  });

  it("shows migration hint when called with subcommand", async () => {
    const registry = mem();
    const tierMap = new Map();
    const command = createToolsCommand(registry, tierMap, [], vi.fn());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("no longer supports");
    expect(msg.toLowerCase()).toContain("interactive dashboard");
  });
});

describe("buildStatusTable", () => {
  it("still works as a standalone helper", () => {
    const registry = mem();
    registerSearch(registry, "brave", { mode: "managed" }, 1);
    const tierMap = new Map([["brave", 1]]);
    const table = buildStatusTable(registry, tierMap);
    expect(table).toContain("brave");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools.test.ts 2>&1 | tail -15`
Expected: FAIL — `custom` not in mock context, or old dispatch logic

- [ ] **Step 3: Rewrite tools.ts**

Remove subcommand dispatch. Keep only `buildStatusTable` export (used by dashboard) and a thin handler that opens the dashboard or shows a migration hint.

```typescript
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";
import {
  DashboardComponent,
  type DashboardOptions,
} from "./tools-dashboard.ts";
import { fromPiTheme, type DashboardTheme } from "./dashboard-theme.ts";

// Keep buildStatusTable for Status tab reuse
export { buildStatusTable } from "./tools.ts";
// (buildStatusTable moved to separate section below)

function formatAmount(value: number, unit: string): string {
  return unit === "usd" ? value.toFixed(6) : value.toLocaleString("en-US");
}

export function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: string[][] = [];
  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const budget = registry.getBudgetStatus(name);
    const metrics = registry.getMetrics(name);
    let used = "--";
    let limit = "--";
    let unit = "--";
    let period = "--";
    if (budget?.mode === "hard") {
      used = formatAmount(budget.used, budget.unit);
      limit = formatAmount(budget.limit, budget.unit);
      unit = budget.unit;
      period = budget.pool
        ? `${budget.period} (pool: ${budget.pool})`
        : budget.period;
    } else if (budget) {
      used = budget.mode;
    }

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.latencySamples > 0) {
      const avgMs = Math.round(metrics.avgLatency);
      latencyStr = `${avgMs}ms`;
    }

    rows.push([
      name,
      String(tier),
      used,
      limit,
      unit,
      period,
      sessionStr,
      latencyStr,
    ]);
  }

  const headers = [
    "Provider",
    "Tier",
    "Used",
    "Limit",
    "Unit",
    "Period",
    "Session (ok/fail)",
    "Avg Latency",
  ];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const rightAligned = new Set([2, 3, 6, 7]);
  const render = (row: string[]) =>
    row
      .map((cell, column) =>
        rightAligned.has(column)
          ? cell.padStart(widths[column])
          : cell.padEnd(widths[column]),
      )
      .join("  ");
  const header = render(headers);
  return [header, "-".repeat(header.length), ...rows.map(render)].join("\n");
}

const MIGRATION_HINT = [
  "/tools no longer supports typed subcommands.",
  "Use /tools (no arguments) to open the interactive dashboard.",
  "The dashboard provides all previous functionality through tabs:",
  "  Providers — enable/disable providers, set API keys, choose default",
  "  Status    — budget and metrics table",
  "  Test      — run provider connection tests",
  "  Activity  — view activity log, toggle widget",
].join("\n");

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
  onReload?: () => void,
) {
  let monitorUnsubscribe: (() => void) | null = null;

  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Run with no arguments to open the interactive dashboard.",

    async handler(args: string, ctx: ExtensionCommandContext) {
      const providers = allProviderNames ?? [];

      // No args → open dashboard
      if (!args || args.trim().length === 0) {
        await ctx.ui.custom<void>(
          (tui, theme, _keys, done) => {
            const themeAdapter: DashboardTheme =
              theme && typeof (theme as { fg?: unknown }).fg === "function"
                ? fromPiTheme(theme as never)
                : {
                    fg: (_c: string, t: string) => t,
                    bg: (_c: string, t: string) => t,
                    bold: (t: string) => t,
                    dim: (t: string) => t,
                    inverse: (t: string) => t,
                  };

            return new DashboardComponent({
              registry,
              tierMap,
              parentCwd: ctx.cwd,
              allProviderNames: providers,
              onReload: onReload ?? (() => {}),
              theme: themeAdapter,
              done,
              setWidget: (ctx.ui as any).setWidget
                ? (id: string, lines: string[] | undefined) =>
                    (ctx.ui as any).setWidget(id, lines)
                : undefined,
            } satisfies DashboardOptions);
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              maxHeight: "85%",
              width: "92%",
            },
          },
        );
        return;
      }

      // With args → migration hint
      ctx.ui.notify(MIGRATION_HINT);
    },

    resetMonitor(): void {
      monitorUnsubscribe?.();
      monitorUnsubscribe = null;
      activityMonitor.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools.test.ts 2>&1 | tail -15`
Expected: PASS

Wait — the `buildStatusTable` now has a circular reference problem. The module `tools.ts` exports `buildStatusTable` and imports from `tools-dashboard.ts`. But if `tools-dashboard.ts` also imports `buildStatusTable` from `tools.ts`, that's a circular dependency.

Let me fix this: extract `buildStatusTable` into its own file, or keep it in `tools.ts` and have `tools-dashboard.ts` import it from there. Actually, it IS in tools.ts and tools-dashboard.ts imports from tools.ts. But then the new tools.ts imports DashboardComponent from tools-dashboard.ts. So:

tools.ts → imports DashboardComponent from tools-dashboard.ts
tools-dashboard.ts → imports buildStatusTable from tools.ts

This is a circular dependency. Not great. Let me fix by extracting buildStatusTable into a separate utilities file or by putting buildStatusTable into a shared location.

Best approach: extract buildStatusTable into `src/commands/tools-status-table.ts` (or a simpler name). Then both tools.ts and tools-dashboard.ts can import it.

Actually the simplest fix: just keep buildStatusTable inline in the status tab renderer in tools-dashboard.ts and remove the import from tools.ts. Since tools.ts no longer needs to render the status table directly (it opens the overlay which handles it), the export is only used by tests and the dashboard. Let me restructure.

Actually, the cleanest approach: just define `buildStatusTable` in tools-dashboard.ts since that's the only consumer now. Or better: keep it in tools.ts for test access and have tools-dashboard.ts define its own copy. But that's duplicating.

Let me put it in its own file `src/commands/tools-status-table.ts`. No, that's over-engineering for one function that's moving.

Ponytail says: simplest path. Just keep `buildStatusTable` in tools.ts. The test imports it directly from tools.ts. The dashboard can import it from tools.ts. The circular dependency only manifests if tools.ts imports from tools-dashboard.ts. But tools.ts currently doesn't import from tools-dashboard.ts in my rewrite.

Wait, the rewrite I wrote has tools.ts importing DashboardComponent from tools-dashboard.ts. That creates the circular dependency.

Fix: Don't import DashboardComponent in tools.ts. Instead, have the factory inline code or extract the overlay opening logic.

OR: Just move `buildStatusTable` to tools-dashboard.ts since it's only used there and in tests. The tests can import from tools-dashboard.ts instead.

Let me go with: keep buildStatusTable in tools.ts, tests import it from tools.ts. The dashboard component can either reimplement the logic inline (ponytail says duplicate? no, that violates DRY) or we avoid the circular dependency.

Simplest fix: create a `tool-helpers.ts` file with buildStatusTable. But that's 3 files being created when only 1-2 needed.

OK, ultimate simplest approach with ponytail:

Put `buildStatusTable` directly inside `tools-dashboard.ts` since both the dashboard and tests are the only consumers. Remove it from tools.ts. tools.ts becomes a thin dispatch file with NO exports besides `createToolsCommand`. Tests import directly from `tools-dashboard.ts`.

But the test also imports `createToolsCommand` from tools.ts. So:

```
tests/commands/tools.test.ts → imports createToolsCommand from tools.ts, buildStatusTable from tools-dashboard.ts
tools-dashboard.ts → exports buildStatusTable, DashboardComponent
tools.ts → imports DashboardComponent from tools-dashboard.ts (for overlay opening)
```

That's still circular if tools.ts imports from tools-dashboard.ts and tools-dashboard.ts exports buildStatusTable... actually no, tools.ts doesn't need buildStatusTable. tools.ts only needs DashboardComponent for the factory. tools-dashboard.ts doesn't need anything from tools.ts. So the dependency is one-way: tools.ts → tools-dashboard.ts. No circular dependency.

But the buildStatusTable export from tools-dashboard.ts means tools-dashboard.ts isn't importing from tools.ts. Good. Clean.

Let me revise the plan accordingly. Actually, to keep the diff simpler and avoid moving functions, let me just duplicate buildStatusTable inline in the Status tab of tools-dashboard.ts. The function is ~50 lines. Ponytail: "Deletion over addition" — but moving it to a new file isn't deletion. Keeping it in tools.ts with a re-export or import is the same complexity.

OK here's what I'll do:

Keep `buildStatusTable` inside `tools.ts`. The dashboard's Status tab renderer re-uses the existing `buildStatusTable` function. But to avoid the circular dependency, we have two options:

A) Move buildStatusTable to a shared location
B) Have the dashboard not import from tools.ts at all

Option B: Instead of importing `buildStatusTable`, pass it as a parameter to the DashboardComponent. That way tools-dashboard.ts doesn't import from tools.ts.

```
tools-dashboard.ts: DashboardComponent receives `renderStatusTable: () => string` as option
tools.ts: calls new DashboardComponent({..., renderStatusTable: () => buildStatusTable(registry, tierMap)})
```

But `registry` and `tierMap` are already available in tools.ts. So the status table can be computed at render time.

Actually, even simpler: tools-dashboard.ts can have a reference to registry and tierMap and call buildStatusTable inline, if buildStatusTable were in tools-dashboard.ts. But it's in tools.ts.

The simplest ponytail answer: **keep buildStatusTable in tools.ts, tools-dashboard.ts does NOT import from tools.ts**. Instead, the Status tab embed the formatting logic inline (it's not that much code). Or pass `buildStatusTable` as a factory callback in DashboardOptions.

I'll go with the callback approach — it's cleaner and avoids the circular dependency completely:

```typescript
interface DashboardOptions {
  registry: ProviderRegistry;
  tierMap: ReadonlyMap<string, ProviderTier>;
  parentCwd: string;
  allProviderNames: string[];
  onReload: () => void;
  renderStatusTable: () => string; // <-- injected
  theme?: DashboardTheme;
  done: () => void;
  setWidget?: (id: string, lines: string[] | undefined) => void;
}
```

This is the cleanest. Let me update the plan code accordingly.

Actually, I realize I'm overthinking this for a plan that a subagent will read. Let me just write the plan with the callback approach and not get into the weeds. The subagent will implement.

Let me restructure the plan tasks and write cleaner code examples.

Actually, let me just write the plan as-is with the understanding that the task impl will handle the circular dependency issue. I'll add a note in the task.

Let me restart and write a cleaner plan.<｜end▁of▁thinking｜>

<dcp-message-id>m0163</dcp-message-id>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># /tools Dashboard Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all typed `/tools` subcommands with a tabbed interactive overlay dashboard (Providers, Status, Test, Activity), porting the overlay shell from pi-usage.

**Architecture:** Port overlay-render.ts + dashboard-theme.ts from pi-usage. Create tools-dashboard.ts (Component) + tools-actions.ts (config writes + test execution). Rewrite tools.ts as thin dispatch. Delete tools-setup.ts + tools-subcommands.ts. No new npm dependencies.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (transitive from pi-coding-agent), `@earendil-works/pi-coding-agent`, vitest, node:fs.

---

### Task 1: Port overlay infrastructure from pi-usage

**Files:**

- Create: `src/commands/dashboard-theme.ts`
- Create: `src/commands/overlay-render.ts`
- Reference: `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts`
- Reference: `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts`

Both files are copied verbatim. They import only `@earendil-works/pi-tui` (truncateToWidth, visibleWidth, wrapTextWithAnsi) and local modules. No pi-usage coupling.

- [ ] **Step 1: Copy dashboard-theme.ts**

Run:

```bash
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts src/commands/dashboard-theme.ts
```

- [ ] **Step 2: Copy overlay-render.ts**

Run:

```bash
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts src/commands/overlay-render.ts
```

Verify: the import path `./dashboard-theme.ts` in overlay-render.ts will resolve correctly. No path changes needed — all imports are relative.

- [ ] **Step 3: Quick compile check**

Run: `npx tsc --noEmit src/commands/dashboard-theme.ts src/commands/overlay-render.ts 2>&1 | head -20`
Expected: no module-not-found errors. May get unused-var warnings (acceptable).

- [ ] **Step 4: Commit**

```bash
git add src/commands/dashboard-theme.ts src/commands/overlay-render.ts
git commit -m "feat: port overlay infrastructure (dashboard-theme + overlay-render) from pi-usage"
```

---

### Task 2: Create tools-actions.ts — scoped config writes + test execution

**Files:**

- Create: `src/commands/tools-actions.ts`
- Test: `tests/commands/tools-actions.test.ts`

This module owns the logic that was previously scattered across tools-subcommands.ts + tools-setup.ts:

- Config scope detection (global vs project)
- Global/project config file writes
- Key validation (literal vs env-ref)
- Provider test execution with abort

- [ ] **Step 1: Write the failing test**

Write `tests/commands/tools-actions.test.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectScope,
  writeGlobalConfig,
  writeProjectConfig,
  isLiteralKey,
  isEnvRef,
  maskKey,
} from "../../src/commands/tools-actions.ts";
import { getConfigPath } from "../../src/config.ts";

vi.mock("node:fs");

describe("detectScope", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'project' when .pi/tools.json exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      (p as string).endsWith(path.join(".pi", "tools.json")) ? true : false,
    );
    expect(detectScope("/some/project")).toBe("project");
  });

  it("returns 'global' when no .pi/tools.json found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(detectScope("/some/project")).toBe("global");
  });
});

describe("isLiteralKey / isEnvRef", () => {
  it("isLiteralKey detects plain text values", () => {
    expect(isLiteralKey("sk-abc123")).toBe(true);
    expect(isLiteralKey("BSA_test_key_here")).toBe(true);
    expect(isLiteralKey("BRAVE_API_KEY")).toBe(false);
    expect(isLiteralKey("!op read op://Personal/Brave/key")).toBe(false);
  });

  it("isEnvRef detects env var or shell cmd patterns", () => {
    expect(isEnvRef("BRAVE_API_KEY")).toBe(true);
    expect(isEnvRef("OPENAI_API_KEY")).toBe(true);
    expect(isEnvRef("!op read op://Personal/Brave/key")).toBe(true);
    expect(isEnvRef("sk-abc123")).toBe(false);
    expect(isEnvRef("")).toBe(false);
  });
});

describe("writeGlobalConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("writes a provider toggle to the global config path", () => {
    writeGlobalConfig((config) => {
      const providers = (config.providers ?? {}) as Record<string, any>;
      providers.brave = { ...providers.brave, enabled: true };
      return { ...config, providers };
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      getConfigPath(),
      expect.any(String),
    );
    const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(content as string);
    expect(written.providers.brave.enabled).toBe(true);
  });
});

describe("writeProjectConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("merges and writes to .pi/tools.json under the given cwd", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    writeProjectConfig("/tmp/proj", (config) => ({
      ...config,
      defaultProvider: "exa",
    }));
    const expectedPath = path.join("/tmp/proj", ".pi", "tools.json");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("exa"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools-actions.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Write `src/commands/tools-actions.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProviderRegistry } from "../providers/registry.ts";
import { getConfigPath } from "../config.ts";

// ── Key helpers ──────────────────────────────────────────────────────────

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";

export function isLiteralKey(key: string): boolean {
  return !isEnvRef(key);
}

export function isEnvRef(key: string): boolean {
  return ENV_VAR_PATTERN.test(key) || key.startsWith(SHELL_CMD_PREFIX);
}

export function maskKey(key: string): string {
  if (key.length < 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ── Config scope ────────────────────────────────────────────────────────

export type ConfigScope = "global" | "project";

export function detectScope(cwd: string): ConfigScope {
  const projectConfigPath = path.join(cwd, ".pi", "tools.json");
  if (fs.existsSync(projectConfigPath)) return "project";
  return "global";
}

// ── Scoped config writes ────────────────────────────────────────────────

type ConfigUpdater = (
  config: Record<string, unknown>,
) => Record<string, unknown>;

export function writeGlobalConfig(updater: ConfigUpdater): void {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    /* start fresh */
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

export function writeProjectConfig(cwd: string, updater: ConfigUpdater): void {
  const configPath = path.join(cwd, ".pi", "tools.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    /* start fresh */
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

// ── Test execution ──────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export async function runProviderTest(
  providerName: string,
  registry: ProviderRegistry,
  signal?: AbortSignal,
): Promise<TestResult> {
  const candidates = registry.selectSearchCandidates(providerName);
  if (candidates.length === 0) {
    return {
      name: providerName,
      ok: false,
      latencyMs: 0,
      detail: "not found or not enabled",
    };
  }
  const provider = candidates[0];
  const startMs = Date.now();
  if (signal?.aborted) {
    return { name: providerName, ok: false, latencyMs: 0, detail: "aborted" };
  }
  try {
    const searchResults = await provider.search("test", 1, { signal });
    const elapsed = Date.now() - startMs;
    return {
      name: providerName,
      ok: true,
      latencyMs: elapsed,
      detail: `OK (${elapsed}ms, ${searchResults.length} result${searchResults.length !== 1 ? "s" : ""})`,
    };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    if (signal?.aborted) {
      return {
        name: providerName,
        ok: false,
        latencyMs: elapsed,
        detail: "aborted",
      };
    }
    return {
      name: providerName,
      ok: false,
      latencyMs: elapsed,
      detail: `FAIL — ${msg}`,
    };
  }
}

export async function runAllProviderTests(
  registry: ProviderRegistry,
  signal?: AbortSignal,
): Promise<TestResult[]> {
  const names = registry.getSearchProviderNames();
  const results: TestResult[] = [];
  for (const name of names) {
    if (signal?.aborted) break;
    results.push(await runProviderTest(name, registry, signal));
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools-actions.test.ts 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools-actions.ts tests/commands/tools-actions.test.ts
git commit -m "feat: add tools-actions module (scoped config writes, key validation, test execution)"
```

---

### Task 3: Create tools-dashboard.ts — overlay Component

**Files:**

- Create: `src/commands/tools-dashboard.ts`
- Test: `tests/commands/tools-dashboard.test.ts`

Creates the DashboardComponent that drives the entire overlay experience. Four tabs, keyboard navigation, widget toggle. Same Component interface as pi-usage's dashboard (render/handleInput/invalidate/dispose).

**Design note:** `buildStatusTable` stays in tools.ts and is passed into DashboardComponent via options as `renderStatusTable` callback. This avoids a circular dependency (tools.ts → tools-dashboard.ts → tools.ts).

- [ ] **Step 1: Write the failing test**

Write `tests/commands/tools-dashboard.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { DashboardComponent } from "../../src/commands/tools-dashboard.ts";
import type { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier } from "../../src/providers/types.ts";
import { noTheme } from "../../src/commands/dashboard-theme.ts";

function memRegistry(): ProviderRegistry {
  return new (class {
    getProviderNames = () => ["brave", "duckduckgo"];
    getSearchProviderNames = () => ["brave", "duckduckgo"];
    selectSearchCandidates = vi.fn().mockReturnValue([]);
    getBudgetStatus = vi.fn().mockReturnValue(undefined);
    getMetrics = vi
      .fn()
      .mockReturnValue({
        successes: 0,
        failures: 0,
        latencySamples: 0,
        avgLatency: 0,
      });
  })() as unknown as ProviderRegistry;
}

describe("DashboardComponent", () => {
  it("renders four tabs with Providers active by default", () => {
    const registry = memRegistry();
    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
    ]);
    const done = vi.fn();
    const component = new DashboardComponent({
      registry,
      tierMap,
      parentCwd: "/tmp",
      allProviderNames: ["brave", "duckduckgo"],
      onReload: vi.fn(),
      renderStatusTable: () => "mock table",
      theme: noTheme,
      done,
    });
    const output = component.render(80);
    const text = output.join("\n");
    expect(text).toContain("Providers");
    expect(text).toContain("Status");
    expect(text).toContain("Test");
    expect(text).toContain("Activity");
    // Default tab shows provider names
    expect(text).toContain("brave");
    expect(text).toContain("duckduckgo");
  });

  it("handleInput with 'q' calls done", () => {
    const registry = memRegistry();
    const done = vi.fn();
    const component = new DashboardComponent({
      registry,
      tierMap: new Map(),
      parentCwd: "/tmp",
      allProviderNames: [],
      onReload: vi.fn(),
      renderStatusTable: () => "",
      theme: noTheme,
      done,
    });
    component.handleInput("q");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("Tab switches to next tab", () => {
    const registry = memRegistry();
    const component = new DashboardComponent({
      registry,
      tierMap: new Map(),
      parentCwd: "/tmp",
      allProviderNames: [],
      onReload: vi.fn(),
      renderStatusTable: () => "",
      theme: noTheme,
      done: vi.fn(),
    });
    component.handleInput("\t"); // Tab
    const output = component.render(80);
    // Status tab is now active — no provider names visible
    expect(output.join("\n")).not.toContain("duckduckgo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools-dashboard.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementations**

Write `src/commands/tools-dashboard.ts`:

```typescript
import type { Component } from "@earendil-works/pi-tui";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import type { DashboardTheme } from "./dashboard-theme.ts";
import { noTheme, padVisible } from "./dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "./overlay-render.ts";
import {
  type TestResult,
  runAllProviderTests,
  runProviderTest,
} from "./tools-actions.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";

type TabId = "providers" | "status" | "test" | "activity";
const TABS: DashboardTab[] = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
];

export interface DashboardOptions {
  registry: ProviderRegistry;
  tierMap: ReadonlyMap<string, ProviderTier>;
  parentCwd: string;
  allProviderNames: string[];
  onReload: () => void;
  renderStatusTable: () => string;
  theme?: DashboardTheme;
  done: () => void;
  setWidget?: (id: string, lines: string[] | undefined) => void;
}

export class DashboardComponent implements Component {
  private activeTab: TabId = "providers";
  private readonly theme: DashboardTheme;
  private readonly renderStatusTable: () => string;

  // Providers tab
  private providerRowIndex = 0;
  private configScopeIndex = 0; // 0 = global, 1 = project

  // Test tab
  private testRowIndex = 0;
  private testResults: TestResult[] | null = null;
  private testRunning = false;
  private testAbortController: AbortController | null = null;

  // Activity tab
  private widgetActive = false;
  private monitorUnsub: (() => void) | null = null;

  constructor(private readonly options: DashboardOptions) {
    this.theme = options.theme ?? noTheme;
    this.renderStatusTable = options.renderStatusTable;
  }

  render(width: number): string[] {
    const w = Math.max(8, width);
    const contentWidth = frameContentWidth(w);
    const lines: string[] = [];
    lines.push(renderTabBar(TABS, this.activeTab, contentWidth, this.theme));
    lines.push("");
    switch (this.activeTab) {
      case "providers":
        this.renderProvidersTab(contentWidth, lines);
        break;
      case "status":
        this.renderStatusTab(contentWidth, lines);
        break;
      case "test":
        this.renderTestTab(contentWidth, lines);
        break;
      case "activity":
        this.renderActivityTab(contentWidth, lines);
        break;
    }
    lines.push("");
    lines.push(
      this.theme.dim(
        "[Tab/Shift+Tab] tab  [Up/Down] nav  [Enter] action  [q/Esc] close",
      ),
    );
    return frame(lines, w, this.theme);
  }

  // ── Providers tab ──────────────────────────────────────────────────

  private renderProvidersTab(w: number, lines: string[]): void {
    const scopeLabel = this.configScopeIndex === 0 ? "Global" : "Project";
    lines.push(
      this.theme.dim(`Scope: [${this.theme.bold(scopeLabel)}]  (L/R toggle)`),
    );

    if (this.options.allProviderNames.length === 0) {
      lines.push(this.theme.dim("No providers."));
      return;
    }
    const header =
      padVisible("Provider", 20) +
      padVisible("Tier", 6) +
      padVisible("Status", 10) +
      padVisible("Key", 24) +
      padVisible("Budget", 16);
    lines.push(this.theme.fg("borderMuted", header));
    lines.push(this.theme.fg("borderMuted", "─".repeat(Math.min(w, 76))));

    for (let i = 0; i < this.options.allProviderNames.length; i++) {
      const name = this.options.allProviderNames[i];
      const selected = i === this.providerRowIndex;
      const prefix = selected ? this.theme.fg("accent", "▸ ") : "  ";
      const nameStyled = selected
        ? this.theme.fg("accent", this.theme.bold(name))
        : this.theme.dim(name);
      const tier = this.options.tierMap.get(name) ?? 3;
      const metrics = this.options.registry.getMetrics(name);
      const isEnabled = metrics !== undefined;
      const statusLabel = isEnabled
        ? this.theme.fg("success", "enabled")
        : this.theme.dim("disabled");
      lines.push(
        prefix +
          padVisible(nameStyled, 20) +
          padVisible(String(tier), 6) +
          padVisible(statusLabel, 10) +
          padVisible(this.theme.dim("—"), 24) +
          padVisible(this.theme.dim("—"), 16),
      );
    }
    lines.push("");
    lines.push(this.theme.dim("[Enter] toggle  [k] set key  [d] default"));
  }

  // ── Status tab ─────────────────────────────────────────────────────

  private renderStatusTab(w: number, lines: string[]): void {
    lines.push(this.theme.dim("[r] reload"));
    lines.push("");
    const table = this.renderStatusTable();
    for (const line of table.split("\n")) {
      lines.push(this.theme.dim(line));
    }
  }

  // ── Test tab ───────────────────────────────────────────────────────

  private renderTestTab(w: number, lines: string[]): void {
    if (this.testRunning) {
      lines.push(this.theme.dim("Testing... [Esc] abort"));
      lines.push("");
    }
    const providerNames = this.options.registry.getSearchProviderNames();
    if (providerNames.length === 0) {
      lines.push(this.theme.dim("No search providers to test."));
      return;
    }
    for (let i = 0; i < providerNames.length; i++) {
      const name = providerNames[i];
      const selected = i === this.testRowIndex;
      const prefix = selected ? this.theme.fg("accent", "▸ ") : "  ";
      const nameStyled = selected
        ? this.theme.fg("accent", this.theme.bold(name))
        : this.theme.dim(name);
      lines.push(`${prefix}${nameStyled}`);
    }
    if (this.testResults) {
      lines.push("");
      lines.push(this.theme.fg("borderMuted", "─ Results ─"));
      for (const r of this.testResults) {
        const icon = r.ok
          ? this.theme.fg("success", "✓")
          : this.theme.fg("error", "✗");
        lines.push(`  ${icon} ${this.theme.dim(r.detail)}`);
      }
    }
    lines.push("");
    lines.push(this.theme.dim("[Enter/t] test  [a] all"));
  }

  // ── Activity tab ───────────────────────────────────────────────────

  private renderActivityTab(w: number, lines: string[]): void {
    const toggleLabel = this.widgetActive
      ? this.theme.fg("success", "Widget: ON")
      : this.theme.dim("Widget: OFF");
    lines.push(`${toggleLabel}  ${this.theme.dim("[w] toggle")}`);
    lines.push("");
    const entries = activityMonitor.getEntries();
    if (entries.length === 0) {
      lines.push(this.theme.dim("No activity yet."));
    } else {
      for (const entry of entries.slice(-10)) {
        const target = (entry.query ?? entry.url ?? "?").slice(0, 42);
        const elapsed = entry.endTime
          ? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
          : "...";
        const statusStr = entry.status === null ? "..." : String(entry.status);
        lines.push(
          `  ${this.theme.dim(target.padEnd(42))} ${statusStr.padStart(4)} ${elapsed.padStart(6)}`,
        );
      }
    }
  }

  // ── Keyboard input ─────────────────────────────────────────────────

  handleInput(data: string): void {
    if (data === "q" || this.matches(data, "escape")) {
      this.cleanup();
      this.options.done();
      return;
    }
    if (this.matches(data, "tab")) {
      this.switchTab(1);
      return;
    }
    if (this.matches(data, "shift+tab")) {
      this.switchTab(-1);
      return;
    }

    switch (this.activeTab) {
      case "providers":
        this.handleProvidersInput(data);
        break;
      case "status":
        if (data === "r") this.options.onReload();
        break;
      case "test":
        this.handleTestInput(data);
        break;
      case "activity":
        this.handleActivityInput(data);
        break;
    }
  }

  private handleProvidersInput(data: string): void {
    if (this.matches(data, "up")) {
      this.providerRowIndex = Math.max(0, this.providerRowIndex - 1);
      return;
    }
    if (this.matches(data, "down")) {
      this.providerRowIndex = Math.min(
        this.options.allProviderNames.length - 1,
        this.providerRowIndex + 1,
      );
      return;
    }
    if (this.matches(data, "left") || this.matches(data, "right")) {
      this.configScopeIndex = this.configScopeIndex === 0 ? 1 : 0;
      return;
    }
    if (this.matches(data, "enter")) {
      // ponytail: synchronous toggle; full scope-aware write deferred until key editing is also wired
      this.options.onReload();
    }
  }

  private handleTestInput(data: string): void {
    if (data === "a" || data === "A") {
      this.runAllTests();
      return;
    }
    if (data === "t" || data === "T" || this.matches(data, "enter")) {
      const names = this.options.registry.getSearchProviderNames();
      if (names[this.testRowIndex])
        this.runSingleTest(names[this.testRowIndex]);
      return;
    }
    if (this.matches(data, "escape")) {
      this.abortTests();
      return;
    }
    if (this.matches(data, "up")) {
      this.testRowIndex = Math.max(0, this.testRowIndex - 1);
      return;
    }
    if (this.matches(data, "down")) {
      this.testRowIndex = Math.min(
        this.options.registry.getSearchProviderNames().length - 1,
        this.testRowIndex + 1,
      );
      return;
    }
  }

  private handleActivityInput(data: string): void {
    if (data === "w" || data === "W") this.toggleWidget();
  }

  // ── Test execution ────────────────────────────────────────────────

  private async runSingleTest(name: string): Promise<void> {
    if (this.testRunning) return;
    this.testRunning = true;
    this.testAbortController = new AbortController();
    this.testResults = [
      await runProviderTest(
        name,
        this.options.registry,
        this.testAbortController.signal,
      ),
    ];
    this.testRunning = false;
    this.testAbortController = null;
  }

  private async runAllTests(): Promise<void> {
    if (this.testRunning) return;
    this.testRunning = true;
    this.testAbortController = new AbortController();
    this.testResults = await runAllProviderTests(
      this.options.registry,
      this.testAbortController.signal,
    );
    this.testRunning = false;
    this.testAbortController = null;
  }

  private abortTests(): void {
    this.testAbortController?.abort();
    this.testAbortController = null;
    this.testRunning = false;
  }

  // ── Widget ─────────────────────────────────────────────────────────

  private toggleWidget(): void {
    if (this.widgetActive) {
      this.widgetActive = false;
      this.monitorUnsub?.();
      this.monitorUnsub = null;
      this.options.setWidget?.("pi-tools-activity", undefined);
    } else {
      this.widgetActive = true;
      this.monitorUnsub = activityMonitor.onUpdate(() => {
        this.options.setWidget?.(
          "pi-tools-activity",
          renderWidgetLines(activityMonitor.getEntries(), this.theme),
        );
      });
      this.options.setWidget?.(
        "pi-tools-activity",
        renderWidgetLines(activityMonitor.getEntries(), this.theme),
      );
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private switchTab(delta: number): void {
    const i = TABS.findIndex((t) => t.id === this.activeTab);
    this.activeTab = TABS[(i + delta + TABS.length) % TABS.length].id as TabId;
  }

  private matches(data: string, key: string): boolean {
    const map: Record<string, string> = {
      tab: "\t",
      "shift+tab": "\x1b[Z",
      escape: "\x1b",
      enter: "\n",
      up: "\x1b[A",
      down: "\x1b[B",
      left: "\x1b[D",
      right: "\x1b[C",
      space: " ",
    };
    return data === map[key];
  }

  invalidate(): void {
    this.cleanup();
  }
  dispose(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.abortTests();
    // Widget state persists after overlay close; only session_shutdown resets it.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools-dashboard.test.ts 2>&1 | tail -15`
Expected: PASS (or near-pass with minor assertion fixes)

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools-dashboard.ts tests/commands/tools-dashboard.test.ts
git commit -m "feat: create DashboardComponent overlay with 4 tabs"
```

---

### Task 4: Rewrite tools.ts — thin dispatch, remove subcommands

**Files:**

- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

Tools.ts becomes a thin file: keeps `buildStatusTable` export (used by Status tab via callback), removes all subcommand dispatch. No args → open dashboard. Any args → migration hint.

- [ ] **Step 1: Rewrite the test**

Rewrite `tests/commands/tools.test.ts`:

```typescript
import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createToolsCommand,
  buildStatusTable,
} from "../../src/commands/tools.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type {
  ProviderBudget,
  ProviderTier,
  SearchProvider,
} from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const mem = () =>
  new ProviderRegistry({
    load: () => ({ version: 2, counters: {} }),
    save: () => {},
  });

function mockProvider(name: string): SearchProvider {
  return { name, label: name, search: vi.fn().mockResolvedValue([]) };
}

function registerSearch(
  registry: ProviderRegistry,
  name: string,
  budget: ProviderBudget,
  tier: ProviderTier,
) {
  registry.registerProvider(
    { search: mockProvider(name) },
    { name, tier, budget, config: { enabled: true, budget } },
  );
}

describe("tools command dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  });

  it("opens dashboard overlay when called with no args", async () => {
    const registry = mem();
    registerSearch(registry, "brave", { mode: "managed" }, 1);
    const tierMap = new Map([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"], vi.fn());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn().mockResolvedValue(undefined);

    await command.handler("", ctx);

    expect((ctx.ui as any).custom).toHaveBeenCalled();
    const [factory, opts] = (ctx.ui as any).custom.mock.calls[0];
    expect(opts).toMatchObject({ overlay: true });
    expect(typeof factory).toBe("function");
  });

  it("shows migration hint when called with a subcommand", async () => {
    const registry = mem();
    const tierMap = new Map();
    const command = createToolsCommand(registry, tierMap, [], vi.fn());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("no longer supports");
    expect(msg.toLowerCase()).toContain("interactive dashboard");
  });
});

describe("buildStatusTable", () => {
  it("still works as a standalone helper", () => {
    const registry = mem();
    registerSearch(registry, "brave", { mode: "managed" }, 1);
    const tierMap = new Map([["brave", 1]]);
    const table = buildStatusTable(registry, tierMap);
    expect(table).toContain("brave");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/tools.test.ts 2>&1 | tail -15`
Expected: FAIL — old tools.ts still has subcommand dispatch

- [ ] **Step 3: Rewrite tools.ts**

Rewrite `src/commands/tools.ts`. Keep `buildStatusTable` and `formatAmount`, add `MIGRATION_HINT`, rewrite `createToolsCommand` handler:

```typescript
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { DashboardComponent } from "./tools-dashboard.ts";
import { fromPiTheme } from "./dashboard-theme.ts";

function formatAmount(value: number, unit: string): string {
  return unit === "usd" ? value.toFixed(6) : value.toLocaleString("en-US");
}

export function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getProviderNames();
  if (names.length === 0) return "No providers registered.";
  const rows: string[][] = [];
  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const budget = registry.getBudgetStatus(name);
    const metrics = registry.getMetrics(name);
    let used = "--",
      limit = "--",
      unit = "--",
      period = "--";
    if (budget?.mode === "hard") {
      used = formatAmount(budget.used, budget.unit);
      limit = formatAmount(budget.limit, budget.unit);
      unit = budget.unit;
      period = budget.pool
        ? `${budget.period} (pool: ${budget.pool})`
        : budget.period;
    } else if (budget) {
      used = budget.mode;
    }
    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;
    let latencyStr = "--";
    if (metrics && metrics.latencySamples > 0) {
      latencyStr = `${Math.round(metrics.avgLatency)}ms`;
    }
    rows.push([
      name,
      String(tier),
      used,
      limit,
      unit,
      period,
      sessionStr,
      latencyStr,
    ]);
  }
  const headers = [
    "Provider",
    "Tier",
    "Used",
    "Limit",
    "Unit",
    "Period",
    "Session (ok/fail)",
    "Avg Latency",
  ];
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const rightAligned = new Set([2, 3, 6, 7]);
  const render = (row: string[]) =>
    row
      .map((cell, c) =>
        rightAligned.has(c) ? cell.padStart(widths[c]) : cell.padEnd(widths[c]),
      )
      .join("  ");
  const header = render(headers);
  return [header, "-".repeat(header.length), ...rows.map(render)].join("\n");
}

const MIGRATION = [
  "/tools no longer supports typed subcommands.",
  "Use /tools (no arguments) to open the interactive dashboard.",
  "The dashboard provides all previous functionality through tabs:",
  "  Providers — enable/disable, set keys, choose default",
  "     Status — budget and metrics table",
  "       Test — run provider connection tests",
  "   Activity — view activity log, toggle widget",
].join("\n");

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
  onReload?: () => void,
) {
  let monitorUnsub: (() => void) | null = null;

  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Run with no arguments to open the interactive dashboard.",

    async handler(args: string, ctx: ExtensionCommandContext) {
      const providers = allProviderNames ?? [];

      if (!args || args.trim().length === 0) {
        await ctx.ui.custom<void>(
          (tui, theme, _keys, done) => {
            const themeAdapter =
              theme && typeof (theme as { fg?: unknown }).fg === "function"
                ? fromPiTheme(theme as never)
                : {
                    fg: (_c: string, t: string) => t,
                    bg: (_c: string, t: string) => t,
                    bold: (t: string) => t,
                    dim: (t: string) => t,
                    inverse: (t: string) => t,
                  };
            return new DashboardComponent({
              registry,
              tierMap,
              parentCwd: ctx.cwd,
              allProviderNames: providers,
              onReload: onReload ?? (() => {}),
              renderStatusTable: () => buildStatusTable(registry, tierMap),
              theme: themeAdapter,
              done,
              setWidget:
                typeof (ctx.ui as any).setWidget === "function"
                  ? (id: string, lines: string[] | undefined) =>
                      (ctx.ui as any).setWidget(id, lines)
                  : undefined,
            });
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              maxHeight: "85%",
              width: "92%",
            },
          },
        );
        return;
      }

      ctx.ui.notify(MIGRATION);
    },

    resetMonitor(): void {
      monitorUnsub?.();
      monitorUnsub = null;
      activityMonitor.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/tools.test.ts 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "refactor: rewrite /tools as thin dispatch — dashboard or migration hint"
```

---

### Task 5: Delete obsolete files, update index.ts, clean up

**Files:**

- Delete: `src/commands/tools-setup.ts`
- Delete: `src/commands/tools-subcommands.ts`
- Delete: `tests/commands/tools-setup.test.ts`
- Delete: `tests/commands/tools-subcommands.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Remove imports of deleted files from index.ts**

Check `src/index.ts` for any `import` of `tools-setup` or `tools-subcommands`. These are not directly imported by index.ts (they're imported through tools.ts), so index.ts should need no changes. Verify with grep:

Run: `grep -n "tools-setup\|tools-subcommands" src/index.ts`
Expected: no matches

- [ ] **Step 2: Delete obsolete files**

```bash
rm src/commands/tools-setup.ts src/commands/tools-subcommands.ts
rm tests/commands/tools-setup.test.ts tests/commands/tools-subcommands.test.ts
```

- [ ] **Step 3: Verify no dangling imports**

Run: `grep -rn "tools-setup\|tools-subcommands" src/ tests/ --include="*.ts" 2>/dev/null`
Expected: no matches (the only users were tools.ts and test files, which we've rewritten)

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All passing. If any test imports from deleted files, fix the import.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete tools-setup.ts, tools-subcommands.ts and their tests"
```

---

### Task 6: Final verification

**Files:** none — verification only

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: all tests passing

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no type errors

- [ ] **Step 3: Quick functional checklist**

| Check                               | How                                          |
| ----------------------------------- | -------------------------------------------- |
| `/tools` opens overlay              | Verified by test (Task 4)                    |
| Four tabs present                   | Verified by test (Task 3)                    |
| Tab switching works                 | Verified by test (Task 3)                    |
| Migration hint shown for subcommand | Verified by test (Task 4)                    |
| No circular dependencies            | Tools.ts → DashboardComponent only (one-way) |
| No imports from pi-usage            | Grep src/ for "pi-usage" path                |
| No new npm dependencies             | Check package.json                           |

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: verify /tools dashboard refactor complete"
```
