# Config Auto-Reload Design

## Summary

Add TTL-based config auto-reload to pi-tools so that edits to `tools.json` take effect mid-session without restarting the extension. Uses a lightweight diff-and-patch approach that preserves provider metrics across reloads.

## Context

Currently, `loadMergedConfig(process.cwd())` is called once at extension startup. The resulting config object is closed over by all tool factories and the provider registry. Edits to `tools.json` during a session have no effect until the next session.

pi-search-hub solves this with a 10-second TTL cache that re-reads config before each tool invocation. pi-tools needs a similar mechanism, but must preserve the `ProviderRegistry`'s accumulated session metrics (rolling window success rates, latency, result quality) which power the `best-performing` selection strategy.

## Approach: Lightweight Config Refresh

Re-read config on a 30-second TTL. Diff the previous config against the new one to determine what changed. Apply minimal mutations to the registry (add/remove/update providers) without destroying metrics.

### Alternatives Considered

**Full provider rebuild:** Tear down and re-instantiate all providers on each reload. Simplest implementation but destructive to session metrics, making `best-performing` selection useless.

**Match pi-search-hub (active list filter):** Re-read JSON and update an active-backends list without touching the registry. Minimal code change but cannot add new providers mid-session or update keys on existing ones. Half-measure.

## Architecture

```
tools.json (global + project)
         │ read (every 30s max)
         ▼
   ConfigManager
   - loadMergedConfig() (existing, reused)
   - TTL check (30s)
   - diffConfig(prev, next) → ConfigChangeSet
   - applyChanges(registry, changeSet)
         │ add/remove/update
         ▼
   ProviderRegistry
   - metrics preserved across reloads
   - providers hot-swapped
```

Tool factories close over `configManager.current` (a getter) instead of a static config snapshot. Each tool invocation calls `configManager.refresh()` at the top; when within TTL this is a single `Date.now()` comparison.

## Components

### ConfigManager (`src/config-manager.ts`)

New class encapsulating the reload lifecycle.

```typescript
class ConfigManager {
  private config: PiToolsConfig;
  private cacheTime: number = 0;
  private readonly ttlMs = 30_000;
  private readonly cwd: string;
  private readonly registry: ProviderRegistry;
  private readonly providerMetas: ProviderMeta[];

  constructor(
    cwd: string,
    registry: ProviderRegistry,
    providerMetas: ProviderMeta[],
  );

  /** Called before each tool invocation. No-op if within TTL. */
  refresh(force?: boolean): void;

  /** Current config (always fresh within TTL). */
  get current(): PiToolsConfig;

  private diffConfig(prev: PiToolsConfig, next: PiToolsConfig): ConfigChangeSet;
  private applyChanges(changeSet: ConfigChangeSet): void;
}
```

### ConfigChangeSet

```typescript
interface ConfigChangeSet {
  added: string[]; // providers newly enabled (need instantiation)
  removed: string[]; // providers newly disabled (remove from registry)
  keyChanged: string[]; // providers whose resolved apiKey differs
  configChanged: boolean; // selectionStrategy, defaultProvider, or guidance changed
}
```

### Diff Logic

- A provider is **added** if it was `enabled: false` (or absent) before and `enabled: true` now.
- A provider is **removed** if it was `enabled: true` before and `enabled: false` now.
- A provider has **key changed** if `resolveApiKey(prev.apiKey) !== resolveApiKey(next.apiKey)`.
- `configChanged` is true when `selectionStrategy`, `defaultProvider`, or `guidance` differ.

### Apply Logic

- **Added:** Look up `ProviderMeta` by name, call `meta.create(resolvedKey, providerConfig)`, register instances with the registry.
- **Removed:** Call `registry.unregisterAll(name)` — removes from search/fetch/codeSearch/docs maps. Metrics (keyed by name) are preserved.
- **Key changed:** Unregister + re-register. Metrics survive because they're keyed by provider name, not instance.
- **configChanged:** Update the config reference. Tool closures read `configManager.current` on each invocation, so they pick up the new values.

### Registry Changes

New methods on `ProviderRegistry`:

```typescript
unregisterSearch(name: string): void;
unregisterFetch(name: string): void;
unregisterCodeSearch(name: string): void;
unregisterDocs(): void;
unregisterAll(name: string): void;  // convenience: all of the above
```

Existing `registerSearch`, `registerFetch`, etc. already support overwrite (Map.set). The `metrics` map is never touched by unregister operations.

No changes to: `recordOutcome`, `recordResultQuality`, `selectSearchCandidates`, `selectSearchByPerformance`, persistence logic.

### Integration with index.ts

Before (startup-only):

```typescript
const config = loadMergedConfig(process.cwd());
const resolveCandidates = config.selectionStrategy === "best-performing" ? ... : ...;
```

After (dynamic):

```typescript
const configManager = new ConfigManager(process.cwd(), registry, allProviders);

const resolveCandidates = (name?: string) => {
  configManager.refresh();
  const resolved = name ?? configManager.current.defaultProvider;
  return configManager.current.selectionStrategy === "best-performing"
    ? registry.selectSearchByPerformance(resolved)
      ? [registry.selectSearchByPerformance(resolved)!]
      : []
    : registry.selectSearchCandidates(resolved);
};
```

Other tool closures that reference `config.guidance` or `config.github` similarly switch to `configManager.current.guidance` / `configManager.current.github`.

### `/tools --reload` Flag

The existing `/tools` command handler gains a `--reload` flag:

```typescript
if (args.includes("--reload")) {
  configManager.refresh(true);
  // Render status as usual (shows updated provider list)
}
```

Reuses the same `refresh(force=true)` path. No separate reload command needed.

## Error Handling

| Scenario                                  | Behavior                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Malformed JSON on reload                  | Skip reload, keep previous valid config. TTL resets for retry next cycle.                                               |
| Provider instantiation failure on hot-add | Skip that provider. Other providers unaffected. Matches startup behavior.                                               |
| Shell-command key resolution failure      | Provider treated as having no key (same as startup: `if (meta.requiresKey && !resolvedKey) continue`).                  |
| Race condition during reload              | Not possible. `refresh()` is synchronous (sync fs reads). Tool invocation is atomic: refresh at top, then use registry. |

## Testing Strategy

### Unit: ConfigManager

- `diffConfig` correctly identifies added/removed/keyChanged providers
- `refresh()` respects TTL (no re-read within 30s window)
- `refresh(true)` always re-reads regardless of TTL
- Malformed JSON on reload preserves previous config
- Provider with changed key is unregistered and re-registered
- `configChanged` detected when selectionStrategy or guidance differ

### Unit: Registry unregister

- `unregisterAll(name)` removes from search/fetch/codeSearch maps
- Metrics map entry survives unregister
- Re-register after unregister: metrics from before are still accessible

### Integration

- Write config to temp file, init ConfigManager, verify initial provider set
- Mutate config file (enable new provider), advance past TTL, call refresh, verify provider added to registry
- Mutate config file (disable provider), refresh, verify provider removed but metrics intact
- `/tools --reload` forces refresh regardless of TTL

## Scope Boundaries

This design does NOT include:

- File-system watchers (`fs.watch`, chokidar) — TTL polling only
- Event emission or callback hooks for config changes
- Schema validation of config values
- Changes to the three-layer merge priority logic
- Changes to `loadMergedConfig` internals
- User-facing notifications on config change (silent reload)

## Decisions

- **TTL: 30 seconds.** Balances responsiveness against filesystem I/O.
- **Force reload: `/tools --reload`.** Extends existing command rather than adding a new one.
- **Notifications: silent.** Config changes take effect quietly. Users can check `/tools --status` to confirm.
- **Metrics preserved.** Unregister/re-register cycle does not clear the metrics map.
