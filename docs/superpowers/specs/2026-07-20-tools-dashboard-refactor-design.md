# /tools Dashboard Refactor — Design Spec

> **Status:** Approved for implementation planning
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

## Phased Delivery

The refactor ships as four independently verifiable phases:

1. Port the overlay shell and add a Status-only dashboard. Only empty `/tools` invocations in TUI mode use the overlay; every typed subcommand remains available.
2. Add Activity and centralize persistent widget ownership.
3. Add Providers, scoped configuration actions, contextual default controls, and resume state across overlay reopen.
4. Add Test, remove the setup/subcommand implementation after parity, and make `/tools` tabs-only.

The phased plans are authoritative. The earlier monolithic implementation plan is superseded rather than maintained in parallel.

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

Pi clips overlay output beyond `maxHeight` and does not scroll it. Providers and Test therefore render a follow-selection window of at most ten rows, centered where possible, with a `Showing X–Y of N` indicator.

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
- `d` returns a `set-default` action for the selected provider.
- `a` returns a `set-default` action for `auto`. On Test, the same key remains contextual and starts all tests.

The component returns actions through `done()` or an action callback so the command handler can perform file I/O and reopen/render fresh state. Actions that reopen the overlay include the active tab and selected provider; the next component receives these as initial state. Reloads, writes, scope switches, and widget toggles therefore return users to the same context. No key is ever placed in the dashboard render output.

## Config Scope and Security

### Paths

- Global: `getConfigPath()` (`<agentDir>/extensions/tools.json`).
- Project: `findProjectConfigPath(ctx.cwd)` for the nearest existing `<CONFIG_DIR_NAME>/tools.json`; if none exists, use `<ctx.cwd>/<CONFIG_DIR_NAME>/tools.json`. `CONFIG_DIR_NAME` is imported from `@earendil-works/pi-coding-agent`, never duplicated as `.pi`.

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

Reuse the existing `buildStatusTable(registry, tierMap)` output. Render it through the ANSI-safe frame, truncating/wrapping long rows for narrow overlays. `r` returns a reload action carrying Status as the resume tab; the command loop refreshes `ConfigManager` and reopens the dashboard on Status.

## Test Tab

Show enabled search providers available in the registry. Up/Down selects; Enter or `t` tests one; `a` tests all. Provider calls use the actual signature:

```ts
provider.search("test", 1, signal);
```

Tests report pass/fail, latency, and result count inline. Each run owns an `AbortController`; starting another run aborts and replaces it, and `dispose()` aborts it. A run identifier/controller check prevents replaced or disposed runs from repainting or replacing current results. A rejected provider call becomes a failed result rather than an unhandled promise rejection. Current-run completion updates the component and calls `tui.requestRender()`.

## Activity Tab and Widget

Render the existing `activityMonitor.getEntries()` using `formatEntryLine()` and the latest ten entries. `w` toggles the persistent `pi-tools-activity` widget through `ctx.ui.setWidget()`.

Widget ownership remains in the `tools.ts` command closure, not in individual dashboard instances:

- one subscription at most
- toggling off unsubscribes and clears the widget
- closing/reopening the dashboard preserves the enabled state
- `session_shutdown` unsubscribes, clears the widget, and clears monitor entries

The active dashboard receives an update callback that calls `tui.requestRender()` when activity changes. Toggling the widget reopens on Activity rather than resetting to the initial tab.

## Migration and Non-UI Behavior

The migration message is:

```text
/tools no longer supports typed subcommands.
Use /tools (no arguments) to open the interactive dashboard.
The dashboard provides the previous status, provider, key, test, default, reload, and monitor actions through tabs.
```

Custom overlays are gated with `ctx.mode === "tui"`, not `ctx.hasUI`: RPC contexts report UI capability but cannot display `ctx.ui.custom()` components.

During Phases 1–3, this mode guard applies only to the empty-argument dashboard branch so typed subcommands keep working outside TUI mode. In Phase 4, non-empty arguments receive the migration hint first; only empty `/tools` outside TUI mode receives the interactive-TUI warning.

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
8. Providers and Test keep the selected row visible through a ten-row window; overlay reopen preserves the active tab and relevant provider selection.
9. All dashboard output, including ANSI-styled text, respects visible width and uses the `/usage` frame/tab conventions.
10. Tests cover mode-aware dispatch, legacy behavior until removal, contextual `a`, resume state, stale async runs, lifecycle cleanup, and every other acceptance criterion.
11. Each phase verifies formatting only for its explicit changed files, then runs `pnpm check`; unrelated baseline formatting debt is out of scope.
12. No `pi-usage` imports and no package dependency changes.
