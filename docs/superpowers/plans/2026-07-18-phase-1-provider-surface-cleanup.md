# Provider Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Remove Exa MCP and the obsolete openai-native alias, then rename the OpenAI web-search rewrite module without changing openai-codex authentication behavior.

**Architecture:** This is a mechanical Phase 1 cleanup. Provider registration will use configured names directly, so removed names become ignored unknown providers. The web-search rewrite keeps the same payload transformation and session gate under an explicit module/export name. Codex credential and default configuration changes remain in Phase 2.

**Tech Stack:** TypeScript, Vitest, Biome, pnpm.

---

## File Map

- Delete src/providers/exa-mcp.ts and tests/providers/exa-mcp.test.ts.
- Modify src/providers/all.ts, src/config-manager.ts, src/config.ts, and their catalog/config tests.
- Rename src/providers/openai-native-rewrite.ts and its test; update src/session.ts.
- Modify README.md and CHANGELOG.md; keep historical changelog references intact.

## Task 1: Update cleanup expectations

**Files:**

- Modify: tests/providers/all.test.ts
- Modify: tests/config.test.ts
- Modify: tests/config-manager.test.ts

- [ ] **Step 1: Reduce the provider catalog expectation.**

Change the catalog count from 23 to 22 and remove only exa-mcp from the sorted expected names.

```
it("exports exactly 22 providers", () => {
  expect(allProviders).toHaveLength(22);
});
```

- [ ] **Step 2: Remove obsolete alias tests.**

Delete the ConfigManager tests named resolves openai-native config alias to openai-codex and does not warn for non-aliased provider names. Do not add a replacement test containing the retired alias; the post-change source scan is the removal contract.

- [ ] **Step 3: Remove obsolete fallback-map expectations.**

Delete the openai-native and openai-codex assertions from the fallback-map test and remove both names from its expected provider list. Leave all other fallback mappings unchanged.

- [ ] **Step 4: Run focused tests before implementation.**

```
pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts
```

Expected: FAIL because Exa MCP is still registered; the fallback-map expectations now pass after removing the obsolete assertions.

## Task 2: Remove Exa MCP and direct alias resolution

**Files:**

- Delete: src/providers/exa-mcp.ts
- Delete: tests/providers/exa-mcp.test.ts
- Modify: src/providers/all.ts
- Modify: src/config-manager.ts
- Modify: src/config.ts

- [ ] **Step 1: Remove Exa MCP from the provider barrel.**

Delete the exaMcp import and the exaMcp array entry from src/providers/all.ts.

```
import { providerMeta as exaMcp } from "./exa-mcp.ts";
```

```
exaMcp,
```

- [ ] **Step 2: Delete the provider implementation and test.**

Delete src/providers/exa-mcp.ts and tests/providers/exa-mcp.test.ts. Do not replace either file; the existing exa provider remains supported.

- [ ] **Step 3: Remove the Exa MCP default.**

Delete only this property from DEFAULT_CONFIG.providers in src/config.ts:

```
"exa-mcp": { enabled: true },
```

Leave the openai-codex and openai-web-search defaults unchanged.

- [ ] **Step 4: Remove alias resolution from ConfigManager.**

Delete PROVIDER_ALIASES and resolveProviderAlias. Replace the beginning of registerProvider with direct metadata lookup:

```
private registerProvider(name: string, config: PiToolsConfig): void {
  const meta = this.metaByName.get(name);
  if (!meta) return;

  const providerConfig = config.providers[name];
```

Keep the existing key resolution, SSRF config injection, provider construction, registration, and exception handling unchanged.

- [ ] **Step 5: Remove only the retired fallback mapping.**

Delete this property from FALLBACK_ENV_MAP:

```
"openai-native": "OPENAI_API_KEY",
```

Retain the openai-codex mapping until Phase 2.

- [ ] **Step 6: Run focused removal tests.**

```
pnpm vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts
```

Expected: PASS with 22 providers, no Exa MCP default, direct unknown-name lookup, and updated fallback expectations.

- [ ] **Step 7: Commit the removal.**

```
git add src/providers/all.ts src/providers/exa-mcp.ts src/config.ts src/config-manager.ts tests/providers/all.test.ts tests/providers/exa-mcp.test.ts tests/config.test.ts tests/config-manager.test.ts
git commit -m "refactor: remove exa mcp and openai native alias"
```

## Task 3: Rename the OpenAI web-search rewrite module

**Files:**

- Rename: src/providers/openai-native-rewrite.ts to src/providers/openai-web-search-rewrite.ts
- Rename: tests/providers/openai-native-rewrite.test.ts to tests/providers/openai-web-search-rewrite.test.ts
- Modify: src/session.ts
- Modify: tests/providers/openai-web-search-rewrite.test.ts

- [ ] **Step 1: Rename both files.**

```
git mv src/providers/openai-native-rewrite.ts src/providers/openai-web-search-rewrite.ts
git mv tests/providers/openai-native-rewrite.test.ts tests/providers/openai-web-search-rewrite.test.ts
```

- [ ] **Step 2: Rename test imports and calls.**

Use this import in the renamed test:

```
import {
  isOpenAiModel,
  rewriteOpenAiWebSearchTool,
} from "../../src/providers/openai-web-search-rewrite.ts";
```

Rename every test description and call from isOpenAiNativeModel to isOpenAiModel and from rewriteNativeWebSearch to rewriteOpenAiWebSearchTool. Keep all inputs and expected payloads unchanged.

- [ ] **Step 3: Run the renamed test before changing source exports.**

```
pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts
```

Expected: FAIL because the source still exports the old identifiers.

- [ ] **Step 4: Rename source exports without compatibility aliases.**

Rename the two exports in the renamed source file and keep their bodies and return shapes unchanged:

```
export function isOpenAiModel(
  model: { provider?: string } | undefined,
): boolean {
  if (!model) return false;
  const provider = (model.provider ?? "").toLowerCase();
  return provider === "openai" || provider.startsWith("openai-");
}

export function rewriteOpenAiWebSearchTool<T extends { tools?: unknown[] }>(
  payload: T,
  options?: { externalWebAccess?: boolean },
): { payload: T; rewritten: string[] } {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    return { payload, rewritten: [] };
  }

  const externalWebAccess = options?.externalWebAccess ?? true;
  const rewritten: string[] = [];

  const newTools = payload.tools.map((tool: unknown) => {
    if (!tool || typeof tool !== "object") return tool;
    const t = tool as { type: string; function?: { name?: string } };
    if (t.type === "function" && t.function?.name === "web_search") {
      rewritten.push("web_search");
      return { type: "web_search", external_web_access: externalWebAccess };
    }
    return tool;
  });

  return {
    payload: { ...payload, tools: newTools },
    rewritten,
  };
}
```

Update the module comment to say OpenAI web search. Do not add old-name re-exports.

- [ ] **Step 5: Update the session consumer.**

Use this import in src/session.ts:

```
import {
  isOpenAiModel,
  rewriteOpenAiWebSearchTool,
} from "./providers/openai-web-search-rewrite.ts";
```

Replace the two calls in handleProviderRequest. Keep the openai-web-search disabled gate, rewritten-length check, and returned payload behavior unchanged.

- [ ] **Step 6: Run rewrite and session tests.**

```
pnpm vitest run tests/providers/openai-web-search-rewrite.test.ts tests/session.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the rename.**

```
git add src/providers/openai-web-search-rewrite.ts src/providers/openai-native-rewrite.ts src/session.ts tests/providers/openai-web-search-rewrite.test.ts tests/providers/openai-native-rewrite.test.ts
git commit -m "refactor: rename openai web search rewrite module"
```

## Task 4: Update documentation and complete verification

**Files:**

- Modify: README.md
- Modify: CHANGELOG.md

- [ ] **Step 1: Remove Exa MCP from README.**

Delete the Exa MCP row from the Available providers table and this configuration example:

```
"exa-mcp": {
  "enabled": true
},
```

Do not add openai-native to README.

- [ ] **Step 2: Add the Unreleased changelog entry.**

Insert immediately above the 0.4.0 section and leave historical entries unchanged:

```markdown
## [Unreleased]

### Changed

- Renamed the OpenAI web-search rewrite module to openai-web-search-rewrite.

### Removed

- Removed the broken Exa MCP provider and the openai-native compatibility alias.
```

- [ ] **Step 3: Verify no current shipped references remain.**

```
rg -n 'exa-mcp|openai-native|openai-native-rewrite|isOpenAiNativeModel|rewriteNativeWebSearch' src tests README.md
```

Expected: no output. Do not include CHANGELOG.md or docs/superpowers/plans/ because those intentionally retain historical and implementation references.

- [ ] **Step 4: Run complete repository checks.**

```
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and the full Vitest suite pass.

- [ ] **Step 5: Verify package contents.**

```
pnpm pack --dry-run
```

The output must contain src/providers/openai-web-search-rewrite.ts and must not contain src/providers/exa-mcp.ts or src/providers/openai-native-rewrite.ts.

- [ ] **Step 6: Check final diff and working tree.**

```
git diff --check origin/master...HEAD
git status --short
```

Expected: no whitespace errors and no uncommitted files after the documentation commit.

- [ ] **Step 7: Commit documentation.**

```
git add README.md CHANGELOG.md
git commit -m "docs: document provider surface cleanup"
```

## Self-Review

- Exa MCP is removed from implementation, registration, defaults, tests, README, and package contents.
- Alias-specific tests are deleted rather than replaced with a permanent reference to the retired name; the zero-match source scan verifies removal.
- README instructions and the source scan are consistent; only changelog and planning documents retain old names.
- Rewrite behavior and session integration are covered by the renamed test and session test.
- openai-codex authentication and API-key mapping are explicitly deferred to Phase 2.
- No compatibility shim, new dependency, or unrelated provider refactor is introduced.
