# Pi Tools Phase 4: Aligned Configuration and Tool Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider refresh, current configuration, and registered tool definitions share one session lifecycle.

**Architecture:** Add a change listener to `ConfigManager`. `index.ts` owns one `registerTools()` closure that reads the manager’s current config and re-registers definitions when the manager applies a valid change. Pi replaces a tool definition by name, so re-registration updates prompt guidance and schemas without accumulating duplicates. Optional docs/research tools are registered at session start and check current availability during execution.

**Tech Stack:** TypeScript, Pi `ExtensionAPI.registerTool`, existing config TTL refresh, Vitest.

---

## Atomic result

After this phase:

- Provider enable/disable/key/config changes are visible to selection and tool definitions during the same session.
- Guidance changes are reflected by replacing the existing tool definition under the same name.
- `web_docs_search`, `web_docs_fetch`, and `web_research` have stable definitions from session start; without credentials they return their existing unavailable messages, and a later config/key refresh makes them usable without restart.
- A malformed config reload leaves the prior providers, config, and tool definitions untouched.
- Re-registering a tool does not create duplicate active definitions.

Phase 4 does not change provider selection algorithms or move extraction fallbacks; phases 3 and 5 own those concerns.

## File map

Modify:

- `src/config-manager.ts` — emit a callback after a valid changed config is applied.
- `src/index.ts` — own one refreshable tool-registration closure and register optional tools unconditionally.
- `src/tools/web-search.ts` — read combine settings through a current-config getter when provided.
- `src/tools/web-research.ts` — read deep-research settings through a current-config getter.
- `tests/helpers.ts` — model Pi’s same-name replacement behavior.
- `tests/config-manager.test.ts` — test change callbacks and no-op/malformed reloads.
- `tests/index.test.ts` — test stable tool names, unavailable-to-available transitions, and no duplicates.
- `tests/index-guidance.test.ts` — test guidance replacement after a config refresh.
- `tests/index-strategy.test.ts` — test current selection strategy after refresh.
- `tests/tools/web-search.test.ts` — cover dynamic combine settings.
- `tests/tools/web-research.test.ts` — cover dynamic deep-research enablement.

No new runtime service or dependency is needed. The existing `ConfigManager` and Pi registration API are the seam.

## Tasks

### Task 1: Add a precise ConfigManager change callback

**Files:**

- Modify: `src/config-manager.ts`
- Modify: `tests/config-manager.test.ts`

- [ ] **Step 1: Define the listener type and constructor option.**

Add a local callback type:

```ts
type ConfigChangeListener = (config: PiToolsConfig) => void;
```

Store an optional listener on `ConfigManager`. Keep the existing constructor arguments working by adding the listener after `modelRegistry`:

```ts
constructor(
  cwd: string,
  registry: ProviderRegistry,
  providerMetas: readonly ProviderMeta[],
  modelRegistry?: ModelRegistry,
  onChange?: ConfigChangeListener,
) {
  // existing initialization
  this.onChange = onChange;
}
```

The listener is not called during initial registration. Initial tool registration remains explicit in `index.ts`.

- [ ] **Step 2: Detect both provider and non-provider behavior changes.**

Keep `diffConfig()` as the provider registration diff. In `refresh()`, compute a `changed` flag before assigning `_config`:

```ts
const changeSet = diffConfig(this._config, nextConfig, resolveApiKey);
const providerChanged =
  changeSet.added.length > 0 ||
  changeSet.removed.length > 0 ||
  changeSet.changed.length > 0;
const configChanged = providerChanged || JSON.stringify(this._config) !== JSON.stringify(nextConfig);

this.applyChanges(changeSet, nextConfig);
this._config = nextConfig;
this.cacheTime = now;
if (configChanged) this.onChange?.(this._config);
```

The explicit provider flag matters when an environment-backed key changes while the serialized config remains identical; `diffConfig()` already detects that resolved-key transition. Do not call the listener for a TTL hit, a no-op reload, or a malformed reload. Keep the malformed-config branch’s previous-config behavior.

- [ ] **Step 3: Test callback timing and no-op behavior.**

Add tests that:

1. receive the new config after a provider enable/disable or key/structure change;
2. receive the new config after guidance, selection strategy, combine, or deep-research changes even when providers are unchanged;
3. are not called when the reloaded config is identical;
4. are not called when `loadMergedConfig()` throws; and
5. observe that the registry has already applied provider changes when the callback runs.

Use `expireTtlForTest()` and the existing mocked `loadMergedConfig` rather than sleeping.

Run:

```bash
pnpm exec vitest run tests/config-manager.test.ts
```

Expected: focused ConfigManager tests pass.

### Task 2: Make tool registration idempotent and refreshable

**Files:**

- Modify: `src/index.ts`
- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-research.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-guidance.test.ts`
- Modify: `tests/tools/web-search.test.ts`
- Modify: `tests/tools/web-research.test.ts`

- [ ] **Step 1: Add one registration closure in `index.ts`.**

Inside `createExtension`, keep the existing store/registry/cache setup and add:

```ts
let registerTools: () => void = () => {};
```

Inside `initializeSession`, create the manager with a callback that invokes the closure:

```ts
configManager = new ConfigManager(
  ctx.cwd,
  registry,
  allProviders,
  ctx.modelRegistry,
  () => registerTools(),
);
```

Define `registerTools` after the manager exists. It must create and call `pi.registerTool()` for all tool definitions using `configManager.current` for guidance and current config getters for execution. Call it once at the end of session initialization.

Do not call `configManager.refresh()` from inside `registerTools()`. Refresh is triggered by resolver/getter callbacks; registration must consume the already-current config and remain side-effect free.

- [ ] **Step 2: Keep resolver functions dynamic and register every stable tool name.**

Keep candidate resolvers closing over `configManager` and pass the phase 3 strategy-aware selection methods. Replace conditional registration with stable registration for:

```text
web_search
web_fetch
web_read
code_search
web_docs_search
web_docs_fetch
web_research
```

Docs and research resolvers continue to return unavailable when credentials or enablement are absent. Their definitions must still be present after `session_start`, so a later refresh can activate them.

Use the current config for each execution boundary:

```ts
const getCombineConfig = () => {
  configManager.refresh();
  return configManager.current.combine;
};

const getDeepResearchConfig = () => {
  configManager.refresh();
  return configManager.current.deepResearch;
};
```

Pass `getCombineConfig` and `getDeepResearchConfig` to the factories. Keep guidance as registration-time data because the listener re-registers definitions whenever guidance changes.

- [ ] **Step 3: Make `web_search` use current combine configuration.**

Add an optional `getCombineConfig?: () => CombineConfig` factory argument. At execution start, use the getter when supplied:

```ts
const activeCombineConfig = getCombineConfig?.() ?? combineConfig;
const combineActive = params.combine ?? activeCombineConfig?.enabled === true;
```

Use `activeCombineConfig` for fusion mode, target backends, and `k`. Preserve the current positional `combineConfig` fallback for direct tests and callers that do not provide a getter.

- [ ] **Step 4: Make `web_research` use current deep-research configuration.**

Change the factory to accept `getDeepResearchConfig?: () => DeepResearchConfig` in addition to the existing config argument. At execution start, after resolving the API key, read:

```ts
const activeConfig = getDeepResearchConfig?.() ?? deepResearchConfig;
if (!activeConfig.enabled) {
  throw new Error("web_research is disabled via deepResearch.enabled config.");
}
```

Use `activeConfig.modeDefaults` and `activeConfig`’s current output schema/guidance inputs wherever the captured config was previously used. Keep the key resolver and existing unavailable error unchanged.

- [ ] **Step 5: Model same-name replacement in the test host.**

Change `createMockPi().registerTool()` from append-only behavior to replacement by `tool.name`:

```ts
registerTool(tool) {
  const index = tools.findIndex((current) => current.name === tool.name);
  if (index === -1) tools.push(tool);
  else tools[index] = tool;
},
```

This matches Pi’s `ExtensionAPI.registerTool()` contract and makes duplicate registration regressions visible. Add an assertion that `new Set(pi.tools.map((tool) => tool.name)).size === pi.tools.length` after session start and after a forced config refresh.

### Task 3: Verify live transitions without weakening trust or error behavior

**Files:**

- Modify: `tests/index.test.ts`
- Modify: `tests/index-guidance.test.ts`
- Modify: `tests/index-strategy.test.ts`
- Modify: `tests/tools/web-search.test.ts`
- Modify: `tests/tools/web-research.test.ts`

- [ ] **Step 1: Test optional tools are stable but availability is dynamic.**

Start with no Exa or Context7 key. Assert all seven tool names are registered. Execute `web_research` and `web_docs_search` and assert their existing unavailable messages.

Then make the mocked trusted config expose literal Exa/Context7 keys, advance/expire the manager TTL through a tool resolver or the `/tools` reload handler, and assert:

1. the same tool names remain present exactly once;
2. the re-registered definitions contain the configured guidance; and
3. the provider resolver now returns the configured provider instead of the unavailable result.

Do not expose a production-only test accessor just to reach the manager; use the existing refresh-triggering command/resolver path.

- [ ] **Step 2: Test guidance replacement.**

Load a config with a custom `guidance.web_search.promptSnippet`, start a session, and assert the registered definition uses it. Reload with a different snippet and assert the same named tool now has the new snippet, with no duplicate tool in `MockPi.tools`.

- [ ] **Step 3: Test strategy and combine changes take effect.**

Start with `selectionStrategy: "auto"` and combine disabled. Change the config to `best-performing` with combine enabled, trigger refresh, and assert the next search uses the performance selector and current fusion settings. Existing explicit `params.combine` overrides must continue to win over config.

- [ ] **Step 4: Preserve trust gating.**

Keep the existing trusted/untrusted project tests. For an untrusted project, credentials remain stripped and the stable optional tools return unavailable; no new path may reintroduce sensitive API keys, base URLs, browser cookies, or SSRF allow ranges.

Run:

```bash
pnpm exec vitest run tests/index.test.ts tests/index-guidance.test.ts tests/index-strategy.test.ts tests/tools/web-search.test.ts tests/tools/web-research.test.ts
```

Expected: tool replacement, dynamic configuration, guidance, strategy, combine, and trust tests pass.

### Task 4: Complete the phase gate and commit

- [ ] **Step 1: Check for conditional registration and append-only test behavior.**

Run:

```bash
rg -n "if \(.*docs|if \(.*research|tools\.push\(|registerTool\(" src/index.ts tests/helpers.ts
```

Expected: `index.ts` has one registration closure and stable optional tool names; `MockPi` replaces same-name entries.

- [ ] **Step 2: Run the complete phase gate.**

```bash
pnpm exec vitest run tests/config-manager.test.ts tests/index.test.ts tests/index-guidance.test.ts tests/index-strategy.test.ts tests/tools/web-search.test.ts tests/tools/web-research.test.ts tests/commands/tools.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts
pnpm check
git diff --check
```

Expected: focused tests and the full suite pass with only the documented pre-existing Biome and Node-engine warnings.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add src/config-manager.ts src/index.ts src/tools/web-search.ts src/tools/web-research.ts tests
git commit -m "refactor: align config refresh with tool lifecycle"
```

The commit must not include content extraction or provider catalog changes.

## Phase completion gate

- Config changes notify the session only after a valid changed reload.
- Tool definitions are replaced by name, not accumulated.
- Optional tools are stable at startup and dynamically available when current config permits.
- Guidance, strategy, combine, trust, and error behavior remain correct.
- Focused tests, `pnpm check`, and `git diff --check` pass.
