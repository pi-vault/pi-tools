# Provider Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Remove Exa MCP and the obsolete `openai-native` alias, and rename the OpenAI web-search rewrite module without changing Codex authentication behavior.

**Architecture:** This phase is intentionally mechanical and independently mergeable. Exa is removed from the provider catalog and defaults; `openai-native` is no longer resolved as an alias; the rewrite module receives an explicit web-search name while preserving its behavior.

**Tech Stack:** TypeScript, Vitest, Biome, pnpm.

---

## File Map

- Delete `src/providers/exa-mcp.ts` and `tests/providers/exa-mcp.test.ts`.
- Modify `src/providers/all.ts`, `src/config-manager.ts`, `src/config.ts`, and their catalog/config tests.
- Rename `src/providers/openai-native-rewrite.ts` and its test; update exports and `src/session.ts`.
- Modify `README.md` and `CHANGELOG.md` for removals and the rename.

## Task 1: Add cleanup regression tests

**Files:**
- Modify: `tests/providers/all.test.ts`, `tests/config.test.ts`, `tests/config-manager.test.ts`

- [ ] **Step 1: Update provider catalog expectations.**

Change the expected provider count from 23 to 22 and remove `exa-mcp` from the expected provider names.

- [ ] **Step 2: Add alias-removal assertions.**

Replace the existing alias test with a test that loads an enabled `openai-native` entry, supplies only an `openai-codex` meta, and asserts that no provider is registered and no deprecation warning is emitted. Keep the existing unknown-provider behavior as the contract.

```ts
it("ignores removed openai-native configuration", () => {
  vi.mocked(loadMergedConfig).mockReturnValue(makeConfig({
    providers: { "openai-native": { enabled: true, apiKey: "sk-test" } },
  }));
  const registry = mem();
  new ConfigManager("/test/cwd", registry, [makeMeta("openai-codex")]);
  expect(registry.getSearchProviderNames()).not.toContain("openai-codex");
});
```

- [ ] **Step 3: Remove obsolete fallback-map expectations.**

Delete assertions and expected names for `openai-native`; leave the `openai-codex` mapping untouched for Phase 2.

- [ ] **Step 4: Run the regression tests and verify they fail.**

Run: `pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts`

Expected: FAIL because Exa registration and alias resolution still exist.

## Task 2: Remove Exa MCP and the alias

**Files:**
- Delete: `src/providers/exa-mcp.ts`, `tests/providers/exa-mcp.test.ts`
- Modify: `src/providers/all.ts`, `src/config-manager.ts`, `src/config.ts`

- [ ] **Step 1: Remove Exa from the provider barrel.**

Delete the `exaMcp` import and array entry in `src/providers/all.ts`.

- [ ] **Step 2: Remove the Exa default.**

Delete the `exa-mcp` entry from `DEFAULT_CONFIG.providers`; do not change the `openai-codex` default in this phase.

- [ ] **Step 3: Remove alias resolution.**

Delete `PROVIDER_ALIASES` and `resolveProviderAlias`. In `registerProvider`, look up metadata directly with `this.metaByName.get(name)` and continue returning for unknown names.

```ts
const meta = this.metaByName.get(name);
if (!meta) return;
```

- [ ] **Step 4: Remove only the obsolete alias fallback mapping.**

Delete `openai-native` from `FALLBACK_ENV_MAP`. Preserve the `openai-codex` mapping until Phase 2.

- [ ] **Step 5: Run removal tests.**

Run: `pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts`

Expected: PASS with 22 providers, no Exa default, no alias registration, and no `openai-native` fallback mapping.

- [ ] **Step 6: Commit the removal.**

```bash
git add src/providers/all.ts src/providers/exa-mcp.ts src/config.ts src/config-manager.ts tests/providers/all.test.ts tests/providers/exa-mcp.test.ts tests/config.test.ts tests/config-manager.test.ts
git commit -m "refactor: remove exa mcp and openai native alias"
```

## Task 3: Rename the rewrite module

**Files:**
- Rename: `src/providers/openai-native-rewrite.ts` to `src/providers/openai-web-search-rewrite.ts`
- Rename: `tests/providers/openai-native-rewrite.test.ts` to `tests/providers/openai-web-search-rewrite.test.ts`
- Modify: `src/session.ts` and the renamed test

- [ ] **Step 1: Rename source and test files.**

```bash
git mv src/providers/openai-native-rewrite.ts src/providers/openai-web-search-rewrite.ts
git mv tests/providers/openai-native-rewrite.test.ts tests/providers/openai-web-search-rewrite.test.ts
```

- [ ] **Step 2: Update the renamed test.**

Import `isOpenAiModel` and `rewriteOpenAiWebSearchTool` from the new module path. Rename every call and description while preserving all assertions.

- [ ] **Step 3: Run the renamed test and verify it fails.**

Run: `pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts`

Expected: FAIL because the source still exports `isOpenAiNativeModel` and `rewriteNativeWebSearch`.

- [ ] **Step 4: Rename source exports and update the session import.**

Rename only the exported identifiers and comments. Update `src/session.ts` to import from `openai-web-search-rewrite.ts` and call `isOpenAiModel` and `rewriteOpenAiWebSearchTool`. Preserve the provider-enabled gate, tool mapping, defaults, and event behavior.

- [ ] **Step 5: Run rewrite and session tests.**

Run: `pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts tests/session.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the rename.**

```bash
git add src/providers/openai-web-search-rewrite.ts src/session.ts tests/providers/openai-web-search-rewrite.test.ts
git commit -m "refactor: rename openai web search rewrite module"
```

## Task 4: Update documentation and verify Phase 1

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README.**

Remove Exa MCP from provider tables and configuration examples. Document that `openai-native` is removed. Do not describe the Codex credential change yet.

- [ ] **Step 2: Add the Phase 1 changelog entry.**

Add an Unreleased entry stating that Exa MCP and the `openai-native` alias were removed and the web-search rewrite module was renamed. Preserve historical entries below it.

- [ ] **Step 3: Check current-source references.**

Run: `rg -n 'exa-mcp|openai-native|openai-native-rewrite|isOpenAiNativeModel|rewriteNativeWebSearch' src tests README.md`

Expected: no matches. Historical `CHANGELOG.md` mentions are allowed.

- [ ] **Step 4: Run repository verification.**

Run: `pnpm check`

Expected: lint, typecheck, and the full test suite pass.

- [ ] **Step 5: Verify package contents and diff.**

Run: `pnpm pack --dry-run` and `git diff --check origin/master...HEAD`.

Expected: no Exa or old rewrite source files are packaged and no whitespace errors exist.

- [ ] **Step 6: Commit documentation.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document provider surface cleanup"
```

## Self-Review

- Exa removal, alias removal, and rewrite renaming are all covered.
- Codex behavior and its API-key mapping are intentionally deferred to Phase 2.
- No compatibility shim or unrelated provider refactor is introduced.
- Every current-source old-name reference is checked while historical changelog text remains intact.
