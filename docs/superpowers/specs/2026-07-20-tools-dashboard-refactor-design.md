# /tools Dashboard Refactor — Design Spec

> **Status:** Approved
> **Date:** 2026-07-20
> **Drivers:** Replace typed subcommand UX with an interactive overlay dashboard

## Rationale

The current `/tools` command exposes 9+ subcommands (status, enable, disable, key, test, default, reload, monitor, setup) plus legacy flags (`--status`, `--reload`). This is hard to discover, forces users to remember exact syntax, and provides no visual feedback for complex operations like provider configuration.

The new design replaces all typed subcommands with a tabbed overlay dashboard — the same interaction model used by `/usage` — making provider management visual, discoverable, and keyboard-driven.

## Architecture

```
/tools (no args)   →   tools-dashboard.ts (overlay Component)
                            ├── Providers tab  (provider list, toggle, keys, scope)
                            ├── Status tab     (budget/metrics table w/ reload)
                            ├── Test tab       (run single/all, inline results, abort)
                            └── Activity tab   (latest 10 entries, widget toggle)
/tools <anything>   →   ctx.ui.notify() with migration hint
```

### New files

- `src/commands/dashboard-theme.ts` — ported from pi-usage; theme adapter + ANSI-safe layout utils
- `src/commands/overlay-render.ts` — ported from pi-usage; frame, tab bar, padding helpers
- `src/commands/tools-dashboard.ts` — overlay Component with 4 tabs
- `src/commands/tools-actions.ts` — scoped config writes (global/project) + test execution logic

### Deleted files

- `src/commands/tools-setup.ts` — replaced by Providers tab
- `src/commands/tools-subcommands.ts` — subcommand logic deleted, no typed subcommands

### Modified files

- `src/commands/tools.ts` — thin dispatch: no args → dashboard, args → migration error
- `src/index.ts` — wire dashboard reset on session_shutdown (already wired for monitor)
- `tests/commands/tools.test.ts` — point at dashboard dispatch + migration
- `tests/commands/tools-subcommands.test.ts` — delete
- `tests/commands/tools-setup.test.ts` — delete

## Tab Design

### 1. Providers Tab

- Lists all providers with: name, tier badge, enabled/disabled status, key status (set/unset/env), budget mode
- Navigate with Up/Down, Enter to toggle enable/disable
- 'k' key: set API key for selected provider (triggers ctx.ui.input modal)
- 'd' key: set as default provider
- L/R: toggle config scope (Global / Project)
  - Global scope: writes to `<agentDir>/extensions/tools.json`
  - Project scope: writes to `.pi/tools.json`; env-ref keys only; literal keys rejected; key editing blocked in untrusted projects

### 2. Status Tab

- Reuses `buildStatusTable()` from current tools.ts
- Renders full provider status table inside the overlay
- 'r' key: trigger config reload, refresh display
- Budget pools and consumption visible inline

### 3. Test Tab

- Shows provider names as selectable items
- Navigate with Up/Down, Enter or 't' to test single provider
- 'a' key: test all providers
- Results appear inline below each provider (pass/fail, latency, result count)
- Running indicator for in-progress tests
- Any active test is automatically aborted when overlay closes (via AbortController)

### 4. Activity Tab

- Shows latest 10 activity entries (reuses ActivityMonitor)
- 'w' key: toggle widget on/off
- Widget state persists after overlay close — only session_shutdown resets it
- Inline display mimics current widget format

## Keyboard Conventions (matching /usage)

| Key             | Action                                   |
| --------------- | ---------------------------------------- |
| Tab / Shift+Tab | Next / previous tab                      |
| Up / Down       | Navigate items within tab                |
| Left / Right    | Tab-contextual (scope, period, provider) |
| Enter           | Primary action (toggle, select)          |
| q / Esc         | Close overlay                            |
| r               | Reload (Status tab)                      |
| t               | Test selected (Test tab)                 |
| a               | Test all (Test tab)                      |
| w               | Toggle widget (Activity tab)             |
| k               | Set API key (Providers tab)              |
| d               | Set default provider (Providers tab)     |

## Config Scope Model

| Aspect                        | Global                             | Project                       |
| ----------------------------- | ---------------------------------- | ----------------------------- |
| Target file                   | `<agentDir>/extensions/tools.json` | `.pi/tools.json`              |
| Literal API keys              | OK                                 | Blocked                       |
| Env-ref keys (!cmd / ENV_VAR) | OK                                 | OK                            |
| Key editing (overlay)         | Full                               | Blocked in untrusted projects |
| Provider toggling             | OK                                 | OK                            |

Detection: if `.pi/tools.json` exists or `cwd` is trusted, Project scope is available. Defaults to Global.

## Migration Path

Old users who type `/tools status`, `/tools enable brave`, etc. see:

```
/tools no longer supports typed subcommands.
Use /tools (no arguments) to open the interactive dashboard.
The dashboard provides all previous functionality (status, enable/disable, keys, test, etc.) through tabs.
```

No deprecation period — all functionality exists in the dashboard. No old subcommand code retained.

## Dependencies

- **No new npm packages.** `@earendil-works/pi-tui` already a transitive dependency of pi-coding-agent (imported by pi-usage pattern).
- `dashboard-theme.ts` and `overlay-render.ts` ported from pi-usage without importing pi-usage modules.
- ActivityMonitor, ProviderRegistry, config.ts — all existing pi-tools modules.

## Acceptance Criteria

1. `/tools` opens overlay with 4 tabs, no typed subcommands accepted
2. Global scope provider toggling and key setting works (writes to tools.json)
3. Project scope blocks literal keys, shows env-refs only
4. Status tab shows budget/metrics table, 'r' reloads
5. Test tab runs single/all with inline results, aborts on close
6. Activity tab shows entries, widget toggle persists after close, resets on shutdown
7. All old tests obsolete or migrated; no new dependencies
8. No imports from pi-usage
