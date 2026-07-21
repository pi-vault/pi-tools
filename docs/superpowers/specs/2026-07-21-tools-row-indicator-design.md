# pi-tools Row Indicator and Selection Highlight

**Date:** 2026-07-21
**Status:** Approved design (pending implementation)

## Context

The `/tools` dashboard in pi-tools renders selectable rows in the Providers and Test tabs using a `>` character as a cursor prefix and `theme.inverse(row)` for the selected-row highlight. `theme.inverse` swaps foreground and background colors, producing a "reverse video" look that reads as a border around the row.

The pi-usage dashboard renders the equivalent rows with a different visual treatment:

- A `▸` (`U+25B8`) glyph as the row marker, with `fg("accent", glyph)` on the selected row and `dim(glyph)` on unselected rows
- A text-level highlight on the row label only (`fg("accent", bold(label))` for selected, `dim(label)` for unselected), with the rest of the row left unstyled

This change aligns the pi-tools visual language with pi-usage for a consistent look across the two extensions, and removes the heavy reverse-video "border" effect in favor of a lighter text highlight.

## Scope

- **In scope**: the Providers and Test tabs in `/tools`. Both have a cursor index (`providerIndex`, `testIndex`) and render rows.
- **Out of scope**: the Status tab (no cursor — it wraps an existing `renderStatusTable` and is purely static), the Activity tab (feed, no selection), the persistent activity widget (separate renderer in `src/monitor/widget.ts`), and footer strings (delimiter character is preserved as-is).

## Approach (Approach B from brainstorming)

Add a tiny file-private helper in `src/commands/tools-dashboard.ts` that returns the styled row prefix, and use it from both `renderProviders` and `renderTest`. The two tabs have materially different cell layouts (Providers has 6 columns with hardcoded widths, Test has 2 columns where the second is a dynamic result detail), so a full per-row helper would over-parameterize. The selection-state ternary is the only piece worth unifying.

## Implementation

### Helper

In `src/commands/tools-dashboard.ts`, near `visibleRange` (currently at line 74):

```ts
const ROW_INDICATOR = "\u25B8"; // right-pointing small triangle (U+25B8)

function renderRowPrefix(selected: boolean, theme: DashboardTheme): string {
  return selected
    ? theme.fg("accent", ROW_INDICATOR)
    : theme.dim(ROW_INDICATOR);
}
```

The helper returns a one-character string that is either accent-colored or dim, matching the selection state. `ROW_INDICATOR` is encoded as `\u25B8` in source so the file remains ASCII-only and the glyph is unambiguous.

### `renderProviders` change

Replace the row loop body (currently at lines 186-197) with:

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
  const prefix = `${renderRowPrefix(isSelected, theme)} `;
  const paddedName = padVisible(truncateVisible(name, 20), 20);
  const nameCell = isSelected
    ? theme.fg("accent", theme.bold(paddedName))
    : theme.dim(paddedName);
  const rest =
    `${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ` +
    `${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ` +
    `${padVisible(truncateVisible(keyState, 22), 22)} ` +
    `${padVisible(entry?.budget.mode ?? "--", 12)} ` +
    `${this.options.config.defaultProvider === name ? "default" : ""}`;
  lines.push(truncateVisible(`${prefix}${nameCell} ${rest}`, contentWidth));
}
```

Differences from the current code:

- `padVisible(index === this.providerIndex ? ">" : "", 2)` → `${renderRowPrefix(isSelected, theme)} ` (the prefix is now a one-character glyph followed by a single space, not a padded column)
- `theme.inverse(row)` (whole row) → only the first cell (provider name) is highlighted with `fg("accent", bold(...))` on selected rows or `dim(...)` on unselected rows. The remaining 5 cells stay unstyled.
- The trimmed name is padded to 20 visible columns inside `nameCell` so alignment with unselected rows (and the header row) is preserved.

### `renderTest` change

Replace the row loop body (currently at lines 221-232) with:

```ts
for (let index = start; index < end; index += 1) {
  const name = names[index];
  const result = results.get(name);
  const detail = result
    ? `${result.ok ? "OK" : "FAIL"} \u2022 ${result.latencyMs}ms \u2022 ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}${result.message === "OK" ? "" : ` \u2022 ${result.message}`}`
    : "";
  const isSelected = index === this.testIndex;
  const prefix = `${renderRowPrefix(isSelected, theme)} `;
  const paddedName = padVisible(truncateVisible(name, 20), 20);
  const nameCell = isSelected
    ? theme.fg("accent", theme.bold(paddedName))
    : theme.dim(paddedName);
  lines.push(truncateVisible(`${prefix}${nameCell} ${detail}`, contentWidth));
}
```

Differences from the current code:

- Same prefix and first-cell highlight pattern as Providers
- `theme.inverse(row)` (whole row) → first cell only
- Existing literal `•` (U+2022) characters in the `detail` string are rewritten as `\u2022` escape sequences; the rendered output is byte-identical
- The header line at line 212 (`"Enter/t Test • a Test all"`) is left alone — it already uses the escape form

### Files to modify

- `src/commands/tools-dashboard.ts` — add helper, change two render methods
- `tests/commands/tools-dashboard.test.ts` — update existing assertions and add new ones (see Testing)

### Files NOT to modify

- `src/tui/dashboard-theme.ts` — `DashboardTheme` already exposes `fg`, `bold`, `dim`, `inverse`; no new methods needed
- `src/tui/overlay-render.ts` — frame and tab chrome are unchanged
- `src/monitor/widget.ts` — activity widget has its own renderer
- `src/commands/tools-actions.ts` — no behavioral changes
- `README.md` — no documentation drift introduced; this change does not add or remove commands

## Testing

### Existing assertions to update

`tests/commands/tools-dashboard.test.ts`:

- Line 250: `expect(component.render(80).join("\n")).toMatch(/> duckduckgo/);` → `expect(component.render(80).join("\n")).toMatch(/▸ duckduckgo/);`
- Line 252: `expect(component.render(80).join("\n")).toMatch(/> brave/);` → `expect(component.render(80).join("\n")).toMatch(/▸ brave/);`

These verify cursor navigation. The shape (`<indicator> <name>`) is unchanged; only the glyph swaps.

### Assertions that stay green unchanged

- Line 271 `/brave.*OK.*1 result/` — text content unchanged
- Lines 305-306 `OK • 7ms • 1 result` and `FAIL • 8ms • 0 results • network down` — rendered delimiter byte-identical
- Line 213 `Enter/t Test • a Test all` — footer text unchanged
- Line 423 `not.toContain("provider-1 ")` — still true; the new indicator is on every row but the prefix `▸ ` (with trailing space) doesn't pad unselected rows the way the old `padVisible("","",2)` did
- Lines 525-526 `^┏.*┓$` and `^┗.*┛$` — frame chrome unaffected

### New assertions to add

In the `describe("ToolsDashboardComponent")` block:

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
  // digit at the same column. With the styled `nameCell` padded to 20
  // visible columns, alignment holds even when the styled name is shorter
  // than 20 visible characters.
  const tierInHeader = header?.indexOf("Tier") ?? -1;
  const tierInRow = row?.indexOf("1") ?? -1;
  expect(tierInRow).toBe(tierInHeader);
});
```

These tests pin the indicator character, lock the delimiter to `U+2022`, lock column alignment with the header, and catch a partial migration (any row still prefixed with `>` will fail).

### Visual verification

The unit tests above use `noTheme` (a pass-through fixture), so they cannot directly assert visual styling — only text content. To verify the rendered look, open a Pi session, run `/tools`, navigate to the Providers and Test tabs, and confirm:

1. Each row begins with `▸` (or a triangle-like glyph)
2. The selected row's first cell is bright (accent foreground, bold)
3. The selected row's other cells retain their normal styling — no reverse-video background
4. Unselected rows appear dim

### Coverage note

This change has no coverage threshold in the project (no coverage reporter configured), so test count is the only signal. Adding five assertions in the same `describe` block raises TUI test count by ~5 cases without disturbing unrelated tests.

## Verification

After implementation:

1. `pnpm check` (or `npm run check`) — biome lint + tsc + vitest. All existing tests plus the new assertions must pass.
2. `pnpm vitest run tests/commands/tools-dashboard.test.ts` — runs the focused file for fast feedback.
3. Manual: launch Pi, run `/tools`, navigate the Providers and Test tabs, confirm the visual treatment matches pi-usage's statistics tab.

## Risk and rollback

Risk: low. The change is rendering-only, with no behavioral or state changes. Test coverage pins the indicator character and the delimiter glyph so accidental regression is caught in CI.

Rollback: revert `src/commands/tools-dashboard.ts` to the previous version and revert the test updates. No persistent state, no migration.
