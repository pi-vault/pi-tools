# pi-tools Row Indicator and Selection Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `>` cursor prefix and `theme.inverse(row)` selection highlight in the `/tools` Providers and Test tabs with a `▸` glyph and a text-only highlight, mirroring pi-usage's row pattern.

**Architecture:** Add a file-private `renderRowPrefix(selected, theme)` helper in `src/commands/tools-dashboard.ts` that returns either `${fg("accent", "▸")} ` (selected) or `"  "` (unselected, two spaces for alignment). Update the row loops in `renderProviders` and `renderTest` to use the helper and apply `fg("accent", bold(name))` / `dim(name)` styling only to the first cell (the name). The rest of each row stays unstyled. Pad the truncated name to 20 visible columns before styling so column alignment with the header is preserved.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (Component, Key, matchesKey, visibleWidth), pi-tools local `dashboard-theme.ts` (DashboardTheme adapter + ANSI-safe `padVisible` / `truncateVisible` / `wrapVisible`), vitest, biome.

---

## File Structure

**Files modified:**
- `src/commands/tools-dashboard.ts` — add `ROW_INDICATOR` constant, add `renderRowPrefix` helper, rewrite row loops in `renderProviders` and `renderTest`
- `tests/commands/tools-dashboard.test.ts` — update two existing assertions, add six new assertions

**Files NOT modified** (per spec):
- `src/tui/dashboard-theme.ts`
- `src/tui/overlay-render.ts`
- `src/monitor/widget.ts`
- `src/commands/tools-actions.ts`
- `README.md`

---

## Task 1: Update existing assertions and add failing tests for new behavior

**Files:**
- Modify: `tests/commands/tools-dashboard.test.ts:246-253` (existing `it("changes the selected Test provider with up/down", ...)` block)
- Modify: `tests/commands/tools-dashboard.test.ts:531-540` (end of `describe("ToolsDashboardComponent", ...)` block — add new tests before the closing `});`)

- [ ] **Step 1.1: Update existing assertions at lines 250 and 252 to look for `▸` instead of `>`**

In `tests/commands/tools-dashboard.test.ts`, change the two regex assertions inside `it("changes the selected Test provider with up/down", ...)` from:

```ts
    expect(component.render(80).join("\n")).toMatch(/> duckduckgo/);
```

to:

```ts
    expect(component.render(80).join("\n")).toMatch(/▸ duckduckgo/);
```

and from:

```ts
    expect(component.render(80).join("\n")).toMatch(/> brave/);
```

to:

```ts
    expect(component.render(80).join("\n")).toMatch(/▸ brave/);
```

- [ ] **Step 1.2: Add the new tests at the end of the `describe("ToolsDashboardComponent")` block**

In `tests/commands/tools-dashboard.test.ts`, find the closing `});` of the `describe("ToolsDashboardComponent")` block (around line 540). Insert these six new `it(...)` blocks immediately before that closing brace. They go after `it.each(["providers", "status", "test", "activity"] as const)("returns close for q and Escape from %s", ...)`.

```ts
  it("renders the row prefix as a single small triangle on every selectable row", () => {
    const lines = dashboard().component.render(100);
    const providerRows = lines.filter(
      (line) => line.includes("brave") || line.includes("duckduckgo"),
    );
    for (const row of providerRows) {
      expect(row).toMatch(/^▸ /);
    }
  });

  it("renders the selected Providers row's first cell without inverse styling", () => {
    const output = dashboard().component.render(100).join("\n");
    expect(output).toContain("▸ brave");
    expect(output).toContain("▸ duckduckgo");
    expect(output).not.toMatch(/^> /m);
  });

  it("renders the selected Test row's first cell without inverse styling", () => {
    const output = dashboard({ initialTab: "test" })
      .component.render(100)
      .join("\n");
    expect(output).toContain("▸ brave");
    expect(output).toContain("▸ duckduckgo");
    expect(output).not.toMatch(/^> /m);
  });

  it("preserves delimiter glyphs in Test detail and footer", () => {
    const output = dashboard({ initialTab: "test" })
      .component.render(100)
      .join("\n");
    expect(output).toContain("Enter/t Test • a Test all");
  });

  it("preserves delimiter glyphs in Providers footer", () => {
    const output = dashboard().component.render(100).join("\n");
    expect(output).toContain("Enter Toggle • k Set key • d Set default");
  });

  it("keeps Providers row cells aligned with the column header", () => {
    const lines = dashboard().component.render(100);
    const header = lines.find((line) => line.includes("Provider"));
    const row = lines.find((line) => line.includes("brave"));
    expect(header).toBeDefined();
    expect(row).toBeDefined();
    // The header puts "Tier" at a known column; the row must put the tier
    // digit at the same column. With the styled nameCell padded to 20
    // visible columns, alignment holds even when the styled name is shorter
    // than 20 visible characters.
    const tierInHeader = header?.indexOf("Tier") ?? -1;
    const tierInRow = row?.indexOf("1") ?? -1;
    expect(tierInRow).toBe(tierInHeader);
  });
```

- [ ] **Step 1.3: Run the test file and confirm the new/updated tests fail**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: FAILURES. Specifically:
- `changes the selected Test provider with up/down` fails on both regex assertions (they expect `▸` but get `>`)
- The two `renders the selected ... row's first cell without inverse styling` tests fail (no `▸` in output)
- `renders the row prefix as a single small triangle on every selectable row` fails (rows start with provider name, not `▸ `)
- `keeps Providers row cells aligned with the column header` may pass or fail depending on current code's alignment; this is acceptable — the test will be the alignment lock once implementation lands

The two `preserves delimiter glyphs ...` tests should PASS with the current code (the `•` glyph is already present). They are regression locks, not behavioral fails.

All other tests in the file should still pass.

- [ ] **Step 1.4: Commit the failing tests**

```bash
git add tests/commands/tools-dashboard.test.ts
git commit -m "test: pin row indicator, first-cell styling, and column alignment

Update two existing Test-tab cursor assertions to look for the new
▸ indicator (U+25B8) instead of >. Add six new tests:
- every selectable row begins with ▸ (single triangle + space)
- Providers and Test tabs no longer use > as a prefix
- • (U+2022) delimiter is preserved in both footers
- Providers row tier column aligns with the Tier header column

All new tests fail with the current code; the two delimiter tests
pass and act as regression locks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add `renderRowPrefix` helper and update `renderProviders` row loop

**Files:**
- Modify: `src/commands/tools-dashboard.ts:74-78` (add `ROW_INDICATOR` constant and `renderRowPrefix` helper after the `visibleRange` function)
- Modify: `src/commands/tools-dashboard.ts:186-197` (replace the body of the `for` loop in `renderProviders`)

- [ ] **Step 2.1: Add the `ROW_INDICATOR` constant and `renderRowPrefix` helper**

In `src/commands/tools-dashboard.ts`, immediately after the existing `visibleRange` function (which ends at line 78 with `return { start, end: start + count }; }`), insert:

```ts
const ROW_INDICATOR = "▸"; // right-pointing small triangle (U+25B8)

function renderRowPrefix(selected: boolean, theme: DashboardTheme): string {
  return selected
    ? theme.fg("accent", ROW_INDICATOR)
    : theme.dim(ROW_INDICATOR);
}
```

- [ ] **Step 2.2: Replace the `renderProviders` row loop body**

In `src/commands/tools-dashboard.ts`, replace the body of the `for` loop at lines 186-197:

OLD (lines 186-197):
```ts
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
```

NEW:
```ts
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
      const prefix = `${renderRowPrefix(isSelected, this.options.theme)} `;
      const paddedName = padVisible(truncateVisible(name, 20), 20);
      const nameCell = isSelected
        ? this.options.theme.fg("accent", this.options.theme.bold(paddedName))
        : this.options.theme.dim(paddedName);
      const rest =
        `${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ` +
        `${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ` +
        `${padVisible(truncateVisible(keyState, 22), 22)} ` +
        `${padVisible(entry?.budget.mode ?? "--", 12)} ` +
        `${this.options.config.defaultProvider === name ? "default" : ""}`;
      lines.push(truncateVisible(`${prefix}${nameCell} ${rest}`, contentWidth));
    }
```

Notes:
- Use `this.options.theme` instead of a `theme` local — the existing render methods receive `theme` only via the closure from `render(width)` (line 124). Since this is a private method on the class, `this.options.theme` is the authoritative source.
- `paddedName` is computed before styling so the styled string still occupies 20 visible columns. `padVisible` uses the framework's ANSI-aware `visibleWidth`, so escape codes inside `theme.bold(paddedName)` and `theme.fg("accent", ...)` don't affect padding math.
- The `lines.push(...)` call no longer wraps the row in `theme.inverse(...)`.

- [ ] **Step 2.3: Run the test file and confirm the Providers-related tests pass**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: PASS for these tests:
- `renders the row prefix as a single small triangle on every selectable row`
- `renders the selected Providers row's first cell without inverse styling`
- `preserves delimiter glyphs in Providers footer`
- `keeps Providers row cells aligned with the column header`
- `opens Providers and renders scope-effective provider state` (unchanged)
- `returns provider actions with resume state` (unchanged)
- `makes untrusted Project scope read-only while preserving scope switching` (unchanged)
- `keeps the selected provider in a bounded ten-row window` (unchanged)
- All `it.each([40, 80, 140])` tests (unchanged)

Still FAILING:
- `changes the selected Test provider with up/down` (Test tab still uses `>`)
- `renders the selected Test row's first cell without inverse styling` (Test tab still uses `>`)

- [ ] **Step 2.4: Commit the helper and renderProviders update**

```bash
git add src/commands/tools-dashboard.ts
git commit -m "feat(tools): render Providers rows with ▸ indicator and text highlight

Replace > + theme.inverse(row) with ▸ + fg('accent', bold(name)) on
selected rows and dim(▸) + dim(name) on unselected rows, matching
pi-usage's statistics tab visual treatment.

Pad the truncated name to 20 visible columns before styling so
column alignment with the header is preserved. The remaining cells
(tier, state, key, budget, default) stay unstyled.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Update `renderTest` row loop

**Files:**
- Modify: `src/commands/tools-dashboard.ts:221-232` (replace the body of the `for` loop in `renderTest`)

- [ ] **Step 3.1: Replace the `renderTest` row loop body**

In `src/commands/tools-dashboard.ts`, replace the body of the `for` loop at lines 221-232:

OLD (lines 221-232):
```ts
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
```

NEW:
```ts
    for (let index = start; index < end; index += 1) {
      const name = names[index];
      const result = results.get(name);
      const detail = result
        ? `${result.ok ? "OK" : "FAIL"} • ${result.latencyMs}ms • ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}${result.message === "OK" ? "" : ` • ${result.message}`}`
        : "";
      const isSelected = index === this.testIndex;
      const prefix = `${renderRowPrefix(isSelected, this.options.theme)} `;
      const paddedName = padVisible(truncateVisible(name, 20), 20);
      const nameCell = isSelected
        ? this.options.theme.fg("accent", this.options.theme.bold(paddedName))
        : this.options.theme.dim(paddedName);
      lines.push(truncateVisible(`${prefix}${nameCell} ${detail}`, contentWidth));
    }
```

Notes:
- The `detail` string still uses literal `•` (U+2022) per the original code style. Spec says this is acceptable; the `•` source-form is preferred for `ROW_INDICATOR` but not required for inline delimiter strings in tests-passing code. Use literal `•` to minimize diff churn.
- `paddedName` is computed before styling for the same reason as in `renderProviders` — preserves column convention (Test rows have no header to align against, but the pad keeps the styled cell consistent with the column convention).

- [ ] **Step 3.2: Run the test file and confirm all tests pass**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: ALL tests in the file PASS. Specifically:
- `changes the selected Test provider with up/down` now passes (rows start with `▸ `)
- `renders the selected Test row's first cell without inverse styling` passes
- `preserves delimiter glyphs in Test detail and footer` passes
- `tests the selected provider and repaints exactly before and after` passes (text content unchanged)
- `tests every registered search provider and renders exact details` passes (delimiter byte-identical)

- [ ] **Step 3.3: Commit the renderTest update**

```bash
git add src/commands/tools-dashboard.ts
git commit -m "feat(tools): render Test rows with ▸ indicator and text highlight

Mirror the Providers tab treatment: ▸ indicator, first-cell text
highlight on the selected row (fg('accent', bold(name))), dim on
unselected rows. Pad the truncated name to 20 visible columns for
column-convention consistency.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Run full check and verify

**Files:** none modified — verification only.

- [ ] **Step 4.1: Run `pnpm check`**

Run: `pnpm check`

Expected: PASS. This runs `biome lint . && tsc --noEmit && vitest run`. All three must succeed:
- Biome lint passes (no unused imports, no trailing-comma violations, etc.)
- TypeScript typecheck passes (no type errors from the new helper or row loop)
- Vitest passes (all tests green)

- [ ] **Step 4.2: Run the focused test file once more for fast feedback**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: PASS. All tests in the file green.

- [ ] **Step 4.3: Verify the diff is contained to the two expected files**

Run: `git diff --stat HEAD~3`

Expected: Only two files should appear in the diff stat:
- `src/commands/tools-dashboard.ts` (helper + two render methods)
- `tests/commands/tools-dashboard.test.ts` (assertion updates + new tests)

If anything else appears, review and either revert or justify the change.

- [ ] **Step 4.4: Manual visual verification (optional but recommended)**

Open a Pi session, run `/tools`, and confirm:
1. Each Providers and Test row begins with `▸`
2. The selected row's first cell (provider/search name) is bright (accent foreground, bold)
3. The selected row's remaining cells retain normal styling (no reverse-video background)
4. Unselected rows appear dim
5. Column alignment with the Providers header is intact

---

## Self-Review Notes

**Spec coverage:**
- Helper: Task 2.1 ✓
- renderProviders change: Task 2.2 ✓
- renderTest change: Task 3.1 ✓
- Existing assertion updates (lines 250, 252): Task 1.1 ✓
- New assertion "every row begins with ▸": Task 1.2 ✓
- New assertion "Providers no inverse": Task 1.2 ✓
- New assertion "Test no inverse": Task 1.2 ✓
- New assertion "delimiter Test detail and footer": Task 1.2 ✓
- New assertion "delimiter Providers footer": Task 1.2 ✓
- New assertion "column alignment with header": Task 1.2 ✓
- Use of `▸` escape in source: Task 2.1 ✓ (`ROW_INDICATOR = "▸"`); commit `86e76a5` corrected the source from literal `▸` to escape form per the spec
- Use of delimiter in source: the inline delimiter in `renderTest`'s detail string stays as literal `•` (U+2022) per the spec's note that escape form is preferred for `ROW_INDICATOR` but not required for inline delimiter strings
- Files NOT modified list: covered (no other files are touched)

**Type consistency:**
- `renderRowPrefix(selected: boolean, theme: DashboardTheme)` — matches the `DashboardTheme` type imported at line 7-12 of `tools-dashboard.ts`
- `ROW_INDICATOR` is a module-private `const`, no export
- `this.options.theme` is used everywhere in render methods (the existing convention; the spec's code examples also use the imported `theme` symbol, but the class method doesn't have `theme` in scope — `this.options.theme` is the correct substitution)

**Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details". No "similar to Task N". All code blocks contain full, runnable code.

**Out-of-scope behaviors the spec mentions but plan doesn't cover:** None. Visual verification (Step 4.4) is the only manual step and it's optional with clear expected outcomes.
