# Provider Cleanup Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Remove the broken Exa MCP and obsolete OpenAI alias, make `openai-codex` use Pi-managed OAuth credentials, and rename the OpenAI web-search rewrite module to an explicit name.

**Architecture:** `openai-codex` becomes OAuth-only and resolves the active Pi `ModelRegistry` supplied by `ExtensionContext`; it uses `find` and `getApiKeyAndHeaders` for the configured model and streams with Pi AI. `openai-web-search` remains the API-key-backed fallback provider. Exa MCP and `openai-native` are removed without compatibility aliases. Search failures throw so `executeWithFallback` can continue to the next provider.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` `ModelRegistry`, Vitest, Biome, and pnpm.

---

## File Map

- Modify `src/providers/types.ts`, `src/config-manager.ts`, and `src/index.ts` to pass the active `ModelRegistry` into provider factories without creating a second runtime.
- Modify `src/providers/openai-codex.ts` to remove AuthStorage/direct-fetch modes and use Pi OAuth resolution and streaming.
- Delete `src/providers/exa-mcp.ts` and its test; remove registration/defaults and update catalog/config tests.
- Rename `src/providers/openai-native-rewrite.ts` and its test to `openai-web-search-rewrite.ts`; rename exports and update `src/session.ts`.
- Modify `README.md` and `CHANGELOG.md` for the new provider boundaries.

## Task 1: Add the ModelRegistry provider-factory boundary

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/config-manager.ts`
- Modify: `src/index.ts`
- Test: `tests/config-manager.test.ts`, `tests/index.test.ts`, `tests/helpers.ts`

- [ ] **Step 1: Add the failing factory-propagation test.**

Extend the provider factory type with an optional third argument and add a test meta whose `create` records it:

```ts
const modelRegistry = {} as ModelRegistry;
const create = vi.fn().mockReturnValue({ search: vi.fn() });
const meta = makeMeta("test-provider", { create });
new ConfigManager("/test/cwd", registry, [meta], modelRegistry);
expect(create).toHaveBeenCalledWith(
  "test-provider",
  expect.anything(),
  modelRegistry,
);
```

Update `makeCtx` with a minimal `modelRegistry` value so `initializeSession` remains type-correct.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `pnpm vitest run tests/config-manager.test.ts tests/index.test.ts`

Expected: FAIL because `ConfigManager` does not yet accept or forward a `ModelRegistry`.

- [ ] **Step 3: Implement the smallest pass-through change.**

Use `import type { ModelRegistry } from "@earendil-works/pi-coding-agent"`. Add `modelRegistry?: ModelRegistry` to `ProviderMeta.create`, store the optional value in `ConfigManager`, pass it as the third argument to `meta.create`, and construct `ConfigManager` in `src/index.ts` with `ctx.modelRegistry`. Do not create or cache a new runtime in this repository.

- [ ] **Step 4: Run the propagation tests.**

Run: `pnpm vitest run tests/config-manager.test.ts tests/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the boundary.**

```bash
git add src/providers/types.ts src/config-manager.ts src/index.ts tests/config-manager.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "refactor: pass active model registry to providers"
```

## Task 2: Replace `openai-codex` credentials and failure semantics

**Files:**

- Modify: `src/providers/openai-codex.ts`
- Modify: `tests/providers/openai-codex.test.ts`
- Keep: `tests/providers/openai-codex-helpers.test.ts`
- Delete: `tests/providers/openai-codex-mode-a.test.ts`

- [ ] **Step 1: Replace AuthStorage/runtime mocks with a ModelRegistry contract.**

Mock the registry and Pi AI stream, not `AuthStorage` or `fetch`:

```ts
const model = {
  id: "gpt-5.4",
  provider: "openai-codex",
  api: "openai-codex-responses",
};
const modelRegistry = {
  find: vi.fn().mockReturnValue(model),
  getApiKeyAndHeaders: vi.fn().mockResolvedValue({
    ok: true,
    apiKey: "oauth-token",
    headers: { "chatgpt-account-id": "acct" },
    env: { OPENAI_BASE_URL: "https://chatgpt.com/backend-api" },
  }),
} as unknown as ModelRegistry;
```

Mock `streamOpenAICodexResponses` to return the existing `submit_search_results` tool-call fixture. Make `getModel` return the requested model ID in the fixture instead of always returning one hard-coded ID.

- [ ] **Step 2: Add failing tests for auth, model, and transport behavior.**

Cover: configured model lookup (`find("openai-codex", configuredModel)`), OAuth lookup on each search, propagation of `apiKey`, `headers`, `env`, and `signal` to `streamOpenAICodexResponses`, and one normalized result. Add tests asserting rejection when the registry is unavailable, `find` returns `undefined`, auth returns `{ ok: false, error }`, auth has no `apiKey`, the stream stops with `error`/`aborted`, the structured tool call is missing, or normalization yields zero results. Errors must be `throw`/rejected promises, not `[]`, because `src/providers/execute.ts` uses rejection to trigger fallback.

- [ ] **Step 3: Run the focused tests and verify they fail.**

Run: `pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts`

Expected: FAIL because the current provider still has dual modes, reads `OPENAI_API_KEY`, and uses obsolete AuthStorage/runtime APIs.

- [ ] **Step 4: Implement OAuth-only search through the active registry.**

Remove `DEFAULT_MODEL_B`, direct Responses endpoint/fetch logic, AuthStorage imports, dual-mode state, and unused mode helpers. The provider factory accepts the generic key argument but ignores it and remains `requiresKey: false`.

On each search:

```ts
signal?.throwIfAborted();
if (!modelRegistry) throw new Error("Pi model registry unavailable");
const model = modelRegistry.find(
  "openai-codex",
  config.model ?? DEFAULT_MODEL_A,
);
if (!model || !hasApi(model, "openai-codex-responses"))
  throw new Error("OpenAI Codex model is unavailable");
const auth = await modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) throw new Error(`${auth.error}; run /login for openai-codex`);
if (!auth.apiKey)
  throw new Error("OpenAI Codex OAuth credentials are unavailable; run /login");
const message = await streamOpenAICodexResponses(model, context, {
  apiKey: auth.apiKey,
  headers: auth.headers,
  env: auth.env,
  signal,
  transport: "sse",
  reasoningEffort: "minimal",
  textVerbosity: "low",
  onPayload: injectCodexSearchPayload,
});
```

Preserve the existing prompt/context, `injectCodexSearchPayload`, URL normalization, and `normalizeCodexToolCallResults`. Throw descriptive errors for aborted/error stop reasons, missing tool calls, and zero normalized results.

- [ ] **Step 5: Run the Codex tests.**

Run: `pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts`

Expected: PASS, including fallback-triggering rejections and no direct `fetch`/`OPENAI_API_KEY` path.

- [ ] **Step 6: Commit the Codex change.**

```bash
git add src/providers/openai-codex.ts tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts tests/providers/openai-codex-mode-a.test.ts
git commit -m "fix: resolve openai codex credentials through model registry"
```

## Task 3: Remove Exa MCP, alias resolution, and obsolete config mappings

**Files:**

- Delete: `src/providers/exa-mcp.ts`, `tests/providers/exa-mcp.test.ts`
- Modify: `src/providers/all.ts`, `src/config.ts`, `src/config-manager.ts`
- Test: `tests/providers/all.test.ts`, `tests/config.test.ts`, `tests/config-manager.test.ts`

- [ ] **Step 1: Add removal assertions.**

Change the provider catalog expectation from 23 to 22 and remove `exa-mcp`. Assert `FALLBACK_ENV_MAP` has no `openai-native` or `openai-codex` entries. Assert a config containing `openai-native` is ignored as an unknown provider and does not register `openai-codex`; preserve generic unknown-provider behavior.

- [ ] **Step 2: Run removal tests and verify they fail.**

Run: `pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts`

Expected: FAIL while Exa registration, alias resolution, and old mappings/defaults remain.

- [ ] **Step 3: Remove the implementation and registration.**

Delete the Exa provider and test, remove its import/array entry from `src/providers/all.ts`, and remove the `exa-mcp` object from `DEFAULT_CONFIG.providers`.

- [ ] **Step 4: Remove alias and API-key fallback paths.**

Delete `PROVIDER_ALIASES` and `resolveProviderAlias`; resolve configured provider names directly. Remove `openai-native` and `openai-codex` from `FALLBACK_ENV_MAP`. Remove the default `openai-codex.apiKey: "OPENAI_API_KEY"`; retain only `{ enabled: true }` so Codex credentials come from Pi OAuth.

- [ ] **Step 5: Run removal tests.**

Run: `pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts`

Expected: PASS with 22 providers, no alias registration, no removed fallback mappings, and no Exa default.

- [ ] **Step 6: Commit provider removal.**

```bash
git add src/providers/all.ts src/providers/exa-mcp.ts src/config.ts src/config-manager.ts tests/providers/all.test.ts tests/providers/exa-mcp.test.ts tests/config.test.ts tests/config-manager.test.ts
git commit -m "refactor: remove exa mcp and openai native alias"
```

## Task 4: Rename the OpenAI web-search rewrite module

**Files:**

- Rename: `src/providers/openai-native-rewrite.ts` → `src/providers/openai-web-search-rewrite.ts`
- Rename: `tests/providers/openai-native-rewrite.test.ts` → `tests/providers/openai-web-search-rewrite.test.ts`
- Modify: `src/session.ts` and the renamed test

- [ ] **Step 1: Rename both files first.**

```bash
git mv src/providers/openai-native-rewrite.ts src/providers/openai-web-search-rewrite.ts
git mv tests/providers/openai-native-rewrite.test.ts tests/providers/openai-web-search-rewrite.test.ts
```

- [ ] **Step 2: Update the renamed test imports and symbols.**

Import `isOpenAiModel` and `rewriteOpenAiWebSearchTool` from the new module. Rename every call and test description while preserving all existing assertions.

- [ ] **Step 3: Run the renamed test and verify it fails.**

Run: `pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts`

Expected: FAIL because the source still exports `isOpenAiNativeModel` and `rewriteNativeWebSearch`.

- [ ] **Step 4: Rename source exports and update the session import/calls.**

Rename only the exported identifiers and module comments. Update `src/session.ts` to import from `openai-web-search-rewrite.ts` and call `isOpenAiModel`/`rewriteOpenAiWebSearchTool`. Preserve OpenAI matching, `external_web_access` defaults, tool mapping, return shape, the `openai-web-search.enabled` gate, and event behavior.

- [ ] **Step 5: Run rewrite and session tests.**

Run: `pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts tests/session.test.ts`

Expected: PASS with no old module import or export references.

- [ ] **Step 6: Commit the rename.**

```bash
git add src/providers/openai-web-search-rewrite.ts src/session.ts tests/providers/openai-web-search-rewrite.test.ts
git commit -m "refactor: rename openai web search rewrite module"
```

## Task 5: Update documentation and current-source references

**Files:**

- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README provider/config documentation.**

Remove Exa MCP from the provider table and configuration example. Describe `openai-codex` as Pi OAuth-authenticated search. Tell API-key users to configure `openai-web-search`; direct MCP users should configure Pi’s MCP support. Do not rewrite historical changelog text.

- [ ] **Step 2: Add an Unreleased changelog section.**

Insert above `0.4.0`:

```markdown
## [Unreleased]

### Changed

- `openai-codex` now resolves Pi OAuth credentials through the active ModelRegistry and no longer embeds an OpenAI API-key fallback.
- Renamed the OpenAI web-search rewrite module to `openai-web-search-rewrite`.

### Removed

- Removed the broken `exa-mcp` provider and the `openai-native` compatibility alias.
```

- [ ] **Step 3: Check current-source references.**

Run: `rg -n 'exa-mcp|openai-native|openai-native-rewrite|isOpenAiNativeModel|rewriteNativeWebSearch' src tests README.md`

Expected: no matches. Run a separate historical check against `CHANGELOG.md` only and allow the intentional migration-history mentions.

- [ ] **Step 4: Commit documentation.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document provider cleanup and auth boundaries"
```

## Task 6: Run complete verification

**Files:** None; verification only.

- [ ] **Step 1: Run focused regression tests.**

```bash
pnpm vitest run \
  tests/providers/openai-codex.test.ts \
  tests/providers/openai-codex-helpers.test.ts \
  tests/providers/openai-web-search-rewrite.test.ts \
  tests/providers/all.test.ts \
  tests/config.test.ts \
  tests/config-manager.test.ts \
  tests/session.test.ts \
  tests/index.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run repository checks.**

Run: `pnpm check`

Expected: Biome, TypeScript, and the full Vitest suite pass with exit code 0.

- [ ] **Step 3: Verify package contents.**

Run: `pnpm pack --dry-run`

Expected: the package includes `src/providers/openai-web-search-rewrite.ts` and excludes `src/providers/exa-mcp.ts` and `src/providers/openai-native-rewrite.ts`.

- [ ] **Step 4: Review the final diff.**

Run: `git diff --check HEAD~5..HEAD && git status --short`

Expected: no whitespace errors and only the planned provider, config, test, and documentation changes remain.

## Self-Review

- Exa removal covers implementation, registration, defaults, catalog tests, README, and package contents.
- Codex auth repair uses the active Pi `ModelRegistry`, covers OAuth errors and fallback-triggering failures, and avoids a duplicate runtime.
- Alias removal covers direct provider lookup, fallback mappings, defaults, and unknown-provider behavior.
- Rewrite renaming is ordered as `git mv` → test update → source update, preserving behavior and avoiding stale imports.
- Search-hub-specific bare-domain/content normalization remains explicitly deferred to a separate spec, as agreed.
- No task contains a placeholder or unspecified edge-case instruction; every code-changing step names its files, behavior, and verification command.
