# Config Auto-Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TTL-based config auto-reload to pi-tools so that edits to `tools.json` take effect mid-session without restarting the extension, preserving provider metrics across reloads.

**Architecture:** Add `unregister*` methods to `ProviderRegistry` for hot-swapping providers without destroying metrics. Create a `ConfigManager` class that wraps `loadMergedConfig` with a 30-second TTL cache, diffs previous vs new config to detect added/removed/key-changed providers, and applies minimal mutations to the registry. Rewire `index.ts` so tool closures read `configManager.current` on each invocation instead of a static startup snapshot. Add `--reload` flag to the existing `/tools` command.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure (`ProviderRegistry`, `loadMergedConfig`, `resolveApiKey`).

**Spec:** `docs/superpowers/specs/2026-07-08-config-auto-reload-design.md`

---

## Phases

This plan is split into 3 atomic phases. Each produces a working, testable result.

| Phase | Deliverable                                          | Depends On |
| ----- | ---------------------------------------------------- | ---------- |
| 1     | Registry unregister methods (hot-swap foundation)    | Nothing    |
| 2     | ConfigManager with TTL, diff, and apply logic        | Phase 1    |
| 3     | Wire ConfigManager into index.ts + /tools --reload   | Phase 2    |

---

## File Map

| Action | File                               | Responsibility                                                   |
| ------ | ---------------------------------- | ---------------------------------------------------------------- |
| Modify | `src/providers/registry.ts`        | Add `unregister*` methods to ProviderRegistry                    |
| Create | `src/config-manager.ts`            | ConfigManager class: TTL cache, diff, apply changes              |
| Modify | `src/index.ts`                     | Replace static config with ConfigManager, update tool closures   |
| Modify | `src/commands/tools.ts`            | Add `--reload` flag, accept ConfigManager dependency             |
| Modify | `tests/providers/registry.test.ts` | Add unregister method tests                                      |
| Create | `tests/config-manager.test.ts`     | ConfigManager unit tests: TTL, diff, apply, error handling       |
| Modify | `tests/commands/tools.test.ts`     | Add `--reload` flag test                                         |

---

## Phase 1: Registry Unregister Methods

See: `docs/superpowers/plans/2026-07-08-config-auto-reload-phase-1-registry-unregister.md`

**Summary:** Add `unregisterSearch`, `unregisterFetch`, `unregisterCodeSearch`, `unregisterDocs`, and `unregisterAll` methods to `ProviderRegistry`. Verify that metrics survive unregister+re-register cycles.

---

## Phase 2: ConfigManager with TTL + Diff

See: `docs/superpowers/plans/2026-07-08-config-auto-reload-phase-2-config-manager.md`

**Summary:** Create `src/config-manager.ts` with `ConfigManager` class. Implements 30-second TTL cache, `diffConfig` to detect added/removed/key-changed providers, and `applyChanges` to hot-swap providers in the registry. Includes error handling for malformed JSON (preserves previous config).

---

## Phase 3: Wire ConfigManager into Extension + /tools --reload

See: `docs/superpowers/plans/2026-07-08-config-auto-reload-phase-3-wire-extension.md`

**Summary:** Replace static `loadMergedConfig()` call in `index.ts` with `ConfigManager`. Update all tool closures to read `configManager.current` dynamically. Update `/tools` command to accept `--reload` flag. Add `--reload` test to `tools.test.ts`.
