# Pi Tools Phase 4: Aligned Configuration and Tool Lifecycle Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Make provider refresh, current configuration, tool definitions, and the native OpenAI web-search rewrite share one session lifecycle.

Architecture: Keep ConfigManager and ProviderRegistry as the existing runtime seams. ConfigManager emits one callback only after a valid semantic config change has been applied. src/index.ts owns one session-local registerTools() closure that consumes the manager’s current config and re-registers the same seven tool names. Pi replaces a tool definition by name, so registration updates guidance and definitions without accumulating duplicates. Provider resolvers and the native rewrite refresh before reading current state; web_search and web_research also receive current-config getters for settings captured at execution time.

Tech stack: TypeScript, Node isDeepStrictEqual, Pi ExtensionAPI.registerTool, existing config TTL refresh, Vitest.

---

## Readiness decision

The previous plan was not ready to implement against the clean post-Phase-3 merge at commit 0ba1098. This revision resolves the concrete mismatches found in the repository:

- Pi’s real registerTool() is name-keyed, but tests/helpers.ts was append-only and could hide duplicate-registration regressions.
- Optional-tool registration behavior is covered by tests/index-research.test.ts; tests/index-guidance.test.ts only tests a guidance utility and is not the right integration target.
- before_provider_request reads configManager.current without refreshing, so the native OpenAI web-search rewrite would remain stale after a config reload.
- web_search captures combineConfig, and web_research captures deepResearchConfig.modeDefaults; registration replacement alone cannot update an already-running definition unless those factories have execution-time getters.
- diffConfig() compares provider structures with order-sensitive JSON.stringify, so the callback needs a semantic equality rule that also prevents false changes from reordered object keys.
- Existing trust and registration tests expect optional tools to be absent. They must be changed to assert stable definitions with unavailable execution when credentials or enablement are missing.
- The current baseline is 89 test files and 1,459 tests. pnpm check exits successfully with the repository’s existing Biome warnings and the environment’s Node 23.11.0 versus the package requirement of Node >=24.15.0.

## Atomic result

After this phase:

- A valid changed config updates the manager’s current config and provider registry before notifying the session.
- Identical semantic config, TTL hits, and malformed reloads do not notify the session.
- Provider enable/disable/key/config changes, selection strategy, guidance, combine settings, and deep-research enablement/mode defaults are visible during the same session.
- web_search, web_fetch, web_read, code_search, web_docs_search, web_docs_fetch, and web_research are registered once at session start and replaced by name after a changed refresh.
- Docs and research tools remain callable definitions when unavailable and return their existing unavailable/disabled errors instead of disappearing from the session.
- The native OpenAI web-search rewrite observes the current openai-web-search configuration after refresh.
- A malformed reload leaves the previous providers, config, and active tool definitions untouched.
- No duplicate active tool names are created by initial registration or refresh.
- Trust gating, credential handling, provider selection algorithms, extraction fallbacks, and existing tool result/error contracts remain unchanged.

## Runtime flow

session_start
-> ConfigManager loads config and registers providers
-> src/index.ts defines registerTools() and registers the seven stable tool names

tool resolver / /tools reload / before_provider_request
-> ConfigManager.refresh()
-> strict load + semantic comparison + provider diff
-> apply provider changes
-> assign current config and TTL
-> notify registerTools() when changed

tool execution / native rewrite
-> read current config and current registry state

## Locked boundaries

This phase may change:

- ConfigManager change notification and semantic provider/config comparison.
- Session-local tool registration and current-config getters.
- Stable optional-tool definitions and their integration tests.
- The native OpenAI web-search rewrite’s refresh path.
- Test-host behavior needed to match Pi’s name-keyed registration.

This phase must not change:

- Provider selection algorithms, scoring, budgets, or execution hooks introduced in Phase 3.
- Extraction fallback routing or provider seams owned by Phase 5.
- Provider catalog contents, trust rules, credential resolution, SSRF allow ranges, or error sanitization.
- Tool parameter schemas, output formats, or unavailable messages.
- The currently unused deepResearch.outputSchema configuration behavior; this phase only makes already-consumed enabled and modeDefaults values current.
- Package dependencies or Node engine requirements.

No new runtime coordinator, dependency, or production test accessor is needed.

## File map

Modify:

- src/config-manager.ts — add the optional change listener and semantic change detection.
- src/index.ts — own the refreshable registration closure, stable optional tools, current execution getters, and refresh-aware native rewrite config getter.
- src/tools/web-search.ts — read combine settings through an optional current-config getter while preserving positional callers.
- src/tools/web-research.ts — read enablement and mode defaults through an optional current-config getter while preserving positional callers.
- tests/helpers.ts — model Pi’s same-name replacement behavior.
- tests/config-manager.test.ts — cover listener timing, semantic no-op reloads, non-provider config changes, environment-backed key changes, and malformed reloads.
- tests/index.test.ts — cover stable tool names, guidance replacement, native rewrite refresh, uniqueness, and trust-safe unavailable behavior.
- tests/index-research.test.ts — replace conditional-registration assertions with stable-definition and live availability transitions.
- tests/index-strategy.test.ts — prove selection strategy changes take effect after a forced refresh.
- tests/tools/web-search.test.ts — cover current combine settings through the new getter.
- tests/tools/web-research.test.ts — cover current deep-research enablement and mode defaults through the new getter.

No changes are required in src/session.ts, tests/session.test.ts, or tests/index-guidance.test.ts: the session handler already accepts a config getter, and the utility-level guidance tests remain valid.

Create: None.

Delete: None.

## Contracts to implement

### ConfigManager listener and equality

In src/config-manager.ts:

type ConfigChangeListener = (config: PiToolsConfig) => void;

Store an optional listener and append it after the existing optional modelRegistry constructor argument:

constructor(
cwd: string,
registry: ProviderRegistry,
providerMetas: readonly ProviderMeta[],
modelRegistry?: ModelRegistry,
onChange?: ConfigChangeListener,
)

The listener is not called during construction. Initial provider registration and initial tool registration remain explicit.

Use isDeepStrictEqual from node:util for both complete-config comparison and provider-entry structure comparison in diffConfig(). Keep resolved-key comparison separate so an environment- or command-backed key change is detected even when the serialized config is unchanged.

On a forced or expired refresh:

1. clear the existing credential cache;
2. load the strict merged config;
3. compute the provider change set;
4. compute providerChanged from the three change-set arrays;
5. compute configChanged as providerChanged || !isDeepStrictEqual(previous, next);
6. apply provider unregister/register changes;
7. assign \_config = next and update the TTL; and
8. call onChange?.(this.\_config) exactly when configChanged is true.

The malformed-config branch keeps the prior config and provider registry, updates only the retry TTL as it does today, and does not call the listener. TTL hits and semantically identical reloads do not call it. The callback observes the new config and an already-updated registry.

### Session registration contract

In src/index.ts, keep the existing store, registry, cache, and session lifecycle. Inside initializeSession:

1. declare a no-op registerTools variable before constructing ConfigManager;
2. pass () => registerTools() as the listener after ctx.modelRegistry;
3. define all resolver functions and current-config getters without calling refresh from the registration closure;
4. assign one registerTools closure that creates and registers all seven tool definitions; and
5. call registerTools() once after assignment.

The seven stable names are:

web_search
web_fetch
web_read
code_search
web_docs_search
web_docs_fetch
web_research

Docs and research resolvers still return no provider when the current config or registry makes them unavailable. Their definitions are nevertheless registered unconditionally so a later refresh can activate them without a restart. Guidance remains registration-time data; the listener replaces the definition when guidance changes.

The registration closure must be side-effect free with respect to config refresh. It reads configManager.current; it must not call configManager.refresh() while constructing definitions, preventing callback recursion.

Pass this refresh-aware getter to handleProviderRequest:

() => {
configManager.refresh();
return configManager.current;
}

Do not add a second config-loading path in src/session.ts.

### Current execution-config contracts

In src/index.ts, provide:

const getCombineConfig = () => {
configManager.refresh();
return configManager.current.combine;
};

const getDeepResearchConfig = () => {
configManager.refresh();
return configManager.current.deepResearch;
};

Keep resolver refreshes and strategy-aware registry selection as they are. The getters and resolvers may both refresh; the TTL makes the second call a no-op.

In src/tools/web-search.ts, append getCombineConfig?: () => CombineConfig after the existing combineConfig argument. At execution start, use the getter when supplied and use the resulting config for:

- default combine activation;
- fusion mode;
- target backend count; and
- RRF k.

If no getter is supplied, preserve the existing captured combineConfig behavior for direct callers and tests. Explicit params.combine continues to override the config’s enabled value.

In src/tools/web-research.ts, append getDeepResearchConfig?: () => DeepResearchConfig after the existing executionHooks argument. After resolving candidates, use the getter when supplied for:

- the enabled defense-in-depth check; and
- modeDefaults passed to applyResearchMode.

If no getter is supplied, preserve the existing captured config behavior. Keep the existing unavailable and disabled errors, query preparation, mode selection, provider request construction, report writing, session entry, and result rendering unchanged.

### Test-host contract

In tests/helpers.ts, make createMockPi().registerTool() replace an existing entry with the same tool.name and append only new names. Assert uniqueness after initial session start and after forced refreshes. This matches Pi’s runtime map behavior and exposes accidental duplicate registration.

## Tasks

### Task 1: Add precise ConfigManager change notification

Files:

- Modify: src/config-manager.ts
- Modify: tests/config-manager.test.ts

- [ ] Step 1: Add the listener and semantic comparison.

Add the constructor option and listener field without changing existing constructor call sites. Replace the provider-structure JSON.stringify comparison with isDeepStrictEqual, and use the same comparison for the complete config in refresh().

- [ ] Step 2: Notify only after a valid changed reload.

Apply the provider change set before assigning the new config and invoking the callback. Preserve the malformed reload behavior and the existing TTL behavior.

- [ ] Step 3: Add focused manager tests.

Using expireTtlForTest() and the existing mocked loadMergedConfig, prove that:

1. provider changes notify with the new config;
2. provider registry changes are visible before the listener runs;
3. guidance, default provider, selection strategy, combine, and deep-research changes notify even when providers are unchanged;
4. an environment-backed key transition not represented by a config-object change notifies and re-registers the provider;
5. reordered but semantically equal object keys do not notify or re-register;
6. an identical reload and a TTL hit do not notify; and
7. a thrown strict reload leaves the prior config/providers intact and does not notify.

Run:

pnpm exec vitest run tests/config-manager.test.ts

Expected: focused ConfigManager tests pass.

### Task 2: Make registration refreshable and optional tools stable

Files:

- Modify: src/index.ts
- Modify: src/tools/web-search.ts
- Modify: src/tools/web-research.ts
- Modify: tests/helpers.ts
- Modify: tests/index.test.ts
- Modify: tests/index-research.test.ts
- Modify: tests/tools/web-search.test.ts
- Modify: tests/tools/web-research.test.ts

- [ ] Step 1: Implement one registration closure.

Move the existing session-start registration calls into one closure. Register all seven stable names on every session, including docs and research. Keep provider resolvers dynamic and pass the two current-config getters to their factories. Pass the refresh-aware config getter to handleProviderRequest.

- [ ] Step 2: Match Pi replacement in the mock host.

Change createMockPi().registerTool() to replace by name. Add a small uniqueness assertion helper or inline assertions; do not add a production registry or test-only production accessor.

- [ ] Step 3: Preserve direct factory compatibility.

Append, rather than insert, the optional getter parameters. Existing direct factory tests and legacy callback arguments must continue to compile and retain their behavior when no getter is provided.

- [ ] Step 4: Verify current combine and research settings.

Add direct factory tests that change the getter result between executions:

1. web_search uses newly enabled combine mode/targets/k and still honors explicit combine: false.
2. web_research uses newly changed mode defaults and rejects execution after the getter reports disabled.

Run:

pnpm exec vitest run tests/index.test.ts tests/index-research.test.ts tests/tools/web-search.test.ts tests/tools/web-research.test.ts

Expected: stable registration, replacement, unavailable behavior, and current execution settings pass.

### Task 3: Prove live transitions, guidance, strategy, native rewrite, and trust behavior

Files:

- Modify: tests/index.test.ts
- Modify: tests/index-research.test.ts
- Modify: tests/index-strategy.test.ts

- [ ] Step 1: Update stable optional-tool expectations.

Replace tests that expect missing docs/research definitions with tests that always find all seven names. With no Context7/Exa capability, execute the stable definitions and assert their existing unavailable/disabled messages. With trusted literal keys, assert the same names remain present and the configured providers become selectable after refresh.

- [ ] Step 2: Test same-name replacement and guidance.

Start with a custom guidance.web_search.promptSnippet, force a /tools reload to a config with a different snippet, and assert:

1. the current web_search definition has the new snippet;
2. the tool name occurs exactly once; and
3. the old definition is not the active entry in MockPi.tools.

Use the existing interactive command mock to trigger configManager.refresh(true); do not expose the manager solely for this test.

- [ ] Step 3: Test current strategy and combine behavior.

Start with selectionStrategy: auto and combine disabled. After a forced reload to best-performing with combine enabled, assert the next search uses the performance selector and current fusion configuration. Preserve explicit provider and explicit combine overrides.

- [ ] Step 4: Test native OpenAI rewrite refresh.

Start with openai-web-search enabled, force a reload with it disabled, and call the existing before_provider_request handler for an OpenAI model. Assert the first payload is rewritten and the post-reload payload is not. This proves the handler reads the manager rather than a stale snapshot.

- [ ] Step 5: Preserve trust gating.

For an untrusted project, project credentials, base URLs, browser-cookie settings, and SSRF ranges remain stripped. Stable optional definitions may exist, but their resolvers return unavailable and no sensitive provider is instantiated. Keep the existing trusted-project assertions for configured literal keys.

Run:

pnpm exec vitest run tests/index.test.ts tests/index-research.test.ts tests/index-strategy.test.ts

Expected: runtime transitions, tool replacement, guidance, strategy, combine, native rewrite, and trust tests pass.

### Task 4: Complete the phase gate and commit

- [ ] Step 1: Check for stale conditional-registration and append-only patterns.

Run:

rg -n "registry\\.selectDocs\\(|researchEnabled|tools\\.push\\(|registerTool\\(" src/index.ts tests/helpers.ts tests/index.test.ts tests/index-research.test.ts

Expected: optional definitions are registered inside the single session closure, MockPi replaces same-name entries, and no test relies on append-only registration.

- [ ] Step 2: Run the complete phase gate.

  pnpm exec vitest run tests/config-manager.test.ts tests/index.test.ts tests/index-research.test.ts tests/index-strategy.test.ts tests/tools/web-search.test.ts tests/tools/web-research.test.ts tests/commands/tools.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/session.test.ts
  pnpm check
  git diff --check

Expected: focused tests and the full suite pass with only the documented pre-existing Biome and Node-engine warnings.

- [ ] Step 3: Commit the atomic phase.

  git add src/config-manager.ts src/index.ts src/tools/web-search.ts src/tools/web-research.ts tests
  git commit -m "refactor: align config refresh with tool lifecycle"

The implementation commit must not include provider catalog, provider-operation-policy, extraction, dependency, or unrelated lint changes.

## Phase completion gate

- Config changes notify only after valid semantic changes, after provider state is applied.
- Environment-backed credential transitions are detected even when the config object is unchanged.
- Tool definitions are replaced by name, not accumulated.
- All seven tool names are stable at startup; optional tools become available or unavailable from current state without restart.
- Guidance, selection strategy, combine settings, deep-research mode defaults, native OpenAI rewrite behavior, trust, and error messages remain correct.
- Malformed reloads preserve the prior usable config, providers, and tool definitions.
- Focused tests, pnpm check, and git diff --check pass.
