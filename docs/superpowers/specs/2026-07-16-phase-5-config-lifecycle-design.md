# Phase 5: Initialize Config from Session Context

**Date:** 2026-07-16
**Status:** Approved design
**Replaces:** The rejected ConfigManager absorption proposal recorded in the architecture deepening spec

## Decision

Keep `ConfigManager` as the config-driven provider lifecycle coordinator. Keep
`ProviderRegistry` focused on provider registration, selection, metrics,
quotas, and persistence.

The earlier proposal to absorb `ConfigManager` remains rejected. This phase
instead fixes when configuration is initialized: after Pi provides the
authoritative session cwd and trust state.

## Problem

The extension factory currently constructs `ConfigManager` with
`process.cwd()`. At that point Pi has not supplied `ExtensionContext`, so the
manager may use the wrong project directory and can only treat project config
as untrusted.

`session_start` records trust and then performs a non-forced refresh. The
30-second TTL can skip that reload, leaving sanitized config active. Tools are
also registered before the trusted refresh, so conditional docs and research
tools can be omitted for the whole session.

## Scope

- Create `ConfigManager` during `session_start` with `ctx.cwd`.
- Record project trust before creating the manager.
- Register config-dependent tools only after the manager loads the trusted
  session config.
- Preserve in-session provider refresh through `ConfigManager.refresh()`.
- Keep tool availability and guidance fixed for the session. Config changes
  that add or remove conditional tools require an extension reload.

## Architecture

The extension factory creates only state that does not depend on project
configuration: the content store, empty provider registry, environment
capabilities, event handlers, and `/tools` command.

The session lifecycle becomes:

```text
extension factory
  -> create store and empty registry
  -> register handlers and /tools command
  -> session_start(ctx)
      -> restore stored content
      -> record ctx.cwd trust state
      -> create ConfigManager(ctx.cwd, registry, allProviders)
      -> load merged trusted config and populate registry
      -> register base tools and eligible conditional tools
```

Pi replaces an extension instance before session startup, reload, resume, new
session, and fork events. Runtime `registerTool()` writes tools by name and
refreshes the active tool set, so registering tools from `session_start` is
supported without an additional compatibility layer.

## Pi Compatibility Review

This design requires `@earendil-works/pi-coding-agent` 0.80.6 or newer. The
reviewed source version is 0.80.6 and the installed version is 0.80.10; no
fallback for older Pi versions is required.

The contract was checked against the Pi source checkout at commit `8479bd84`,
whose coding-agent package is version 0.80.6:

- `AgentSession.bindExtensions()` awaits `session_start` before completing
  extension binding.
- `ExtensionContext.cwd` and `isProjectTrusted()` resolve from the bound session
  and settings manager at call time.
- `registerTool()` updates the extension tool map and immediately refreshes the
  session tool registry. Newly registered tools become active unless excluded
  by Pi's normal tool filters.
- New, resumed, forked, and reloaded sessions receive fresh extension runtimes
  before `session_start`.
- Pi's dynamic-tool and runtime-event tests cover registration from
  `session_start` and replacement-session lifecycle ordering.

## Components

### `src/index.ts`

Keep the existing wiring in this file, but move `ConfigManager` construction
and tool registration into one local session initializer. The initializer
receives `ExtensionContext`, constructs the manager with `ctx.cwd`, and then
registers the existing base and conditional tools.

The `/tools` command remains registered by the extension factory. Its reload
callback references the session-initialized manager and is only callable after
Pi has emitted `session_start`.

The `before_provider_request` and `model_select` handlers remain registered by
the factory. Pi's event order guarantees that config initialization precedes
provider requests.

### `src/session.ts`

Keep `handleSessionStart()` responsible for orchestration. Replace its
conceptual `refresh` callback with an initializer callback that receives the
current `ExtensionContext`.

The required order is:

1. Restore valid stored content.
2. Record project trust.
3. Invoke the session initializer.

### Existing config and registry modules

`ConfigManager`, `ProviderRegistry`, config diffing, TTL behavior, provider
aliases, and provider construction remain unchanged. The rejected absorption
plan must not be implemented.

## Data Flow

At session start, `recordProjectTrust(ctx)` caches trust for `ctx.cwd`.
`ConfigManager` then calls `loadMergedConfig(ctx.cwd)`, which can safely read
and merge that project's trusted sensitive fields. Its constructor populates
the existing registry from the resulting provider configuration.

Tool factories receive the same configuration values they use today, but the
values now come from the authoritative session config. Provider-selection
callbacks continue to refresh the manager before reading registry candidates.

## Error Handling

No new fallback layer is added.

- Existing config loading behavior handles missing or malformed files.
- Existing provider construction behavior skips a provider whose factory
  throws without affecting other providers.
- No uninitialized-manager fallback is introduced. A tool or command running
  before `session_start` would violate Pi's lifecycle contract and should fail
  visibly instead of silently using the wrong config.

## Testing

Update lifecycle tests to emit `session_start` before inspecting or executing
registered tools. Add focused assertions that:

- config-dependent tools are absent before `session_start`;
- project config is resolved from `ctx.cwd`, not `process.cwd()`;
- trust is recorded before the session initializer runs;
- trusted session config controls conditional docs and research tool
  registration;
- existing content restoration and provider-request rewriting still work.

Keep the existing `ConfigManager` tests unchanged. Verify with the targeted
lifecycle tests followed by `pnpm check`.

## Out of Scope

- Absorbing `ConfigManager` into `ProviderRegistry`.
- Dynamically changing conditional tools within a session. Pi provides
  `setActiveTools()`, but session-scoped tool availability is the simpler
  contract for this extension.
- Updating tool guidance within a session.
- Correcting extraction modules that independently call
  `loadMergedConfig(process.cwd())`; those calls are a separate boundary.
- Adding new modules, dependencies, or configuration abstractions.

## Success Criteria

- Project config uses the cwd and trust state supplied by Pi.
- No config-dependent tool is registered from factory-time config.
- Conditional tools match the trusted config at session start.
- Provider refresh, content restoration, commands, and request rewriting retain
  their current behavior.
- Typecheck, lint, and the full test suite pass.
