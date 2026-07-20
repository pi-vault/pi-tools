# /tools Dashboard Refactor — Design Spec

> **Status:** Revised for implementation
> **Date:** 2026-07-20

## Goal

Replace the typed `/tools` command interface with a four-tab overlay dashboard that matches the `/usage` shell while preserving safe, scope-aware provider configuration.

## Scope

`/tools` becomes a tabs-only command:

- `/tools` opens the dashboard.
- `/tools <anything>` shows a migration hint and performs no action.
- The old subcommands and setup wizard are removed.

The four tabs are **Providers**, **Status**, **Test**, and **Activity**. No new package or runtime dependency on `pi-usage` is introduced.

## Architecture

```text
/tools
  └─ tools.ts
       └─ ctx.ui.custom(..., { overlay: true })
            └─ tools-dashboard.ts (Component)
                 ├─ Providers
                 ├─ Status
                 ├─ Test
                 └─ Activity
```

The frame, tab pills, ANSI-safe padding, and theme adapter are copied into `src/tui/` from `pi-usage`:

- `src/tui/dashboard-theme.ts`
- `src/tui/overlay-render.ts`

They import only `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`, and local modules. `pi-tools` never imports from the `pi-usage` package or repository at runtime.

Responsibilities:

- `tools-actions.ts`: pure key classification, project-path resolution, safe document reads/writes, scoped provider/default updates, and provider test execution.
- `tools-dashboard.ts`: rendering, tab state, keyboard handling, and action results. It receives current effective config and callbacks; it does not read or write files directly.
- `tools.ts`: command entry point, dashboard loop, action orchestration, and activity-widget ownership.
- `ConfigManager`: remains the source of effective runtime configuration and is refreshed after writes.

## Overlay Shell

Use the same `ctx.ui.custom()` factory and overlay options as `/usage`:

```ts
await ctx.ui.custom<void>(
  (tui, theme, keybindings, done) =>
    new ToolsDashboardComponent({
      tui,
      theme: fromPiTheme(theme),
      keybindings,
      done,
      // state and action callbacks
    }),
  {
    overlay: true,
    overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
  },
);
```

Use `matchesKey(data, Key.*)` from `@earendil-works/pi-tui`; do not hand-roll terminal escape-sequence maps. Call `tui.requestRender()` after navigation, state changes, and async test/activity updates. Every rendered line must be ANSI-safely truncated to the supplied width.

The component implements `render(width)`, `handleInput(data)`, `invalidate()`, and `dispose()`. `dispose()` aborts an active test and unsubscribes component-owned listeners.

## Providers Tab

Display every provider from `allProviders`, including providers that are currently disabled or missing credentials. Each row contains:

- provider name
- tier
- effective enabled state from the loaded config, not `registry.getMetrics()`
- key state: `set`, `unset`, or `env: NAME`; never display a secret value
- budget mode/unit
- default marker for the effective `defaultProvider`

Navigation:

- Up/Down selects a provider.
- Left/Right switches between Global and Project scope.
- Enter returns a `toggle` action.
- `k` returns a `set-key` action; the command handler owns the input prompt.
- `d` returns a `set-default` action.

The component returns actions through `done()` or an action callback so the command handler can perform file I/O and reopen/render fresh state. No key is ever placed in the dashboard render output.

## Config Scope and Security

### Paths

- Global: `getConfigPath()` (`<agentDir>/extensions/tools.json`).
- Project: `findProjectConfigPath(ctx.cwd)` for the nearest existing `.pi/tools.json`; if none exists, use `<ctx.cwd>/.pi/tools.json`.

Project scope is selectable when the project is trusted or a project config exists. The dashboard displays the selected target path. Global is the default.

### Writes

Use a read-modify-write operation that preserves unknown JSON fields and all untouched provider fields:

1. Read the target file.
2. If it does not exist (`ENOENT`), start with `{}`.
3. If it exists but contains malformed JSON, return an error and do not call `writeFileSync`.
4. If another read error occurs, return an error and do not write.
5. Apply a narrow updater.
6. Write formatted JSON only after successful parsing/updating.

Project writes require `ctx.isProjectTrusted() === true`. Project credential values must match the environment-variable-name pattern `^[A-Z][A-Z0-9_]+$`. Literal secrets and values beginning with `!` (shell commands) are rejected. This restriction applies to new or edited `providers.<name>.apiKey` values. Global scope accepts the existing literal/env/shell formats.

A rejected or failed action leaves the file unchanged and reports a warning through `ctx.ui.notify()`.

### Actions

- Toggle updates only `providers.<name>.enabled`.
- Set key updates only `providers.<name>.apiKey`, after scope/trust validation.
- Set default updates only `defaultProvider`; permitted values are `auto` or a known provider name.
- Reload refreshes `ConfigManager` and the dashboard reads the new effective config.

## Status Tab

Reuse the existing `buildStatusTable(registry, tierMap)` output. Render it through the ANSI-safe frame, truncating/wrapping long rows for narrow overlays. `r` refreshes `ConfigManager`, invalidates the component, and requests a render.

## Test Tab

Show enabled search providers available in the registry. Up/Down selects; Enter or `t` tests one; `a` tests all. Provider calls use the actual signature:

```ts
provider.search("test", 1, signal);
```

Tests report pass/fail, latency, and result count inline. Each run owns an `AbortController`; `dispose()` aborts it. A rejected provider call becomes a failed result rather than an unhandled promise rejection. Completion updates the component and calls `tui.requestRender()`.

## Activity Tab and Widget

Render the existing `activityMonitor.getEntries()` using `formatEntryLine()` and the latest ten entries. `w` toggles the persistent `pi-tools-activity` widget through `ctx.ui.setWidget()`.

Widget ownership remains in the `tools.ts` command closure, not in individual dashboard instances:

- one subscription at most
- toggling off unsubscribes and clears the widget
- closing/reopening the dashboard preserves the enabled state
- `session_shutdown` unsubscribes, clears the widget, and clears monitor entries

The active dashboard receives an update callback that calls `tui.requestRender()` when activity changes.

## Migration and Non-UI Behavior

The migration message is:

```text
/tools no longer supports typed subcommands.
Use /tools (no arguments) to open the interactive dashboard.
The dashboard provides the previous status, provider, key, test, default, reload, and monitor actions through tabs.
```

If `ctx.hasUI` is false, `/tools` reports that the dashboard requires interactive UI instead of calling `ctx.ui.custom()`.

## Files

Create:

- `src/tui/dashboard-theme.ts`
- `src/tui/overlay-render.ts`
- `src/commands/tools-actions.ts`
- `src/commands/tools-dashboard.ts`
- `tests/commands/tools-actions.test.ts`
- `tests/commands/tools-dashboard.test.ts`

Modify:

- `src/commands/tools.ts`
- `src/index.ts` only if required to pass widget/session lifecycle callbacks
- `tests/commands/tools.test.ts`

Delete:

- `src/commands/tools-setup.ts`
- `src/commands/tools-subcommands.ts`
- their obsolete tests

## Acceptance Criteria

1. `/tools` opens a centered four-tab overlay; arguments are rejected with the migration hint.
2. Providers shows all provider rows with effective enabled/key/default/budget state.
3. Global toggle, key, and default actions persist changes while preserving unknown fields.
4. Project writes use the nearest/fallback project path, reject malformed overwrites, require trust, and accept only environment-variable names for credentials.
5. Status renders budget/metrics and reloads with `r`.
6. Test runs one/all providers with inline results, correct abort propagation, and repainting.
7. Activity renders the latest ten entries; widget state persists across overlay reopen and is cleaned up at shutdown.
8. All dashboard output respects width and uses the `/usage` frame/tab conventions.
9. Tests cover every acceptance criterion; `pnpm check` passes.
10. No `pi-usage` imports and no package dependency changes.
