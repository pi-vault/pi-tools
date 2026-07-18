# OpenAI Codex OAuth Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make openai-codex use Pi-managed OAuth through the active ModelRegistry, reject unusable responses for provider fallback, and remove its API-key configuration path.

**Architecture:** Pass the active ExtensionContext.modelRegistry through provider construction; never create a second Pi runtime. Resolve the configured Codex model and fresh OAuth credentials for every search, then call the supported Pi AI Codex stream subpath. Keep openai-web-search as the API-key alternative.

**Tech Stack:** TypeScript, @earendil-works/pi-ai 0.80.x APIs, @earendil-works/pi-coding-agent ModelRegistry, Vitest, Biome, pnpm.

---

## Findings

- The branch is clean at origin/master; the current focused tests and typecheck pass.
- Pi AI 0.80.10 and current Pi main do not export streamOpenAICodexResponses from the package root. The supported export is stream from @earendil-works/pi-ai/api/openai-codex-responses.
- Pi coding-agent 0.80.10 does not export AuthStorage from its root. Existing Mode A tests mock nonexistent exports and do not validate the runtime path.
- Use the common find, isUsingOAuth, and getApiKeyAndHeaders ModelRegistry methods. Do not upgrade Pi or depend on unreleased getProvider/getProviderAuth methods.

## File Map

- Registry boundary: src/providers/types.ts, src/config-manager.ts, src/index.ts, tests/config-manager.test.ts, tests/helpers.ts.
- Codex behavior: src/providers/openai-codex.ts, tests/providers/openai-codex.test.ts; delete tests/providers/openai-codex-mode-a.test.ts.
- Configuration/docs: src/config.ts, tests/config.test.ts, tests/extract/config-video.test.ts, README.md, CHANGELOG.md.
- Keep tests/providers/openai-codex-helpers.test.ts unchanged.

## Task 1: Pass the active ModelRegistry

**Files:** Modify src/providers/types.ts, src/config-manager.ts, src/index.ts, tests/config-manager.test.ts, tests/helpers.ts.

- [ ] **Step 1: Add the failing propagation test.** Import ModelRegistry as a type. Use a valid provider instance in the factory spy and assert the same registry reaches the third argument:

```ts
const modelRegistry = {} as ModelRegistry;
const create = vi.fn().mockReturnValue({
  search: {
    name: "brave",
    label: "Brave",
    search: vi.fn().mockResolvedValue([]),
  },
});
const meta = makeMeta("brave", { create });
new ConfigManager("/test/cwd", registry, [meta], modelRegistry);
expect(create).toHaveBeenCalledWith(
  undefined,
  expect.objectContaining({ ssrfAllowRanges: [] }),
  modelRegistry,
);
```

Add modelRegistry: {} as ModelRegistry to makeCtx.

- [ ] **Step 2: Verify the test fails.** Run pnpm vitest run tests/config-manager.test.ts tests/index.test.ts. Expected: failure because ConfigManager has no registry argument or forwarding.

- [ ] **Step 3: Implement the smallest pass-through.** Add a type-only ModelRegistry import. Extend ProviderMeta.create with modelRegistry?: ModelRegistry. Add the optional fourth ConfigManager constructor argument, store it, and call meta.create(resolvedKey, configWithSsrf, this.modelRegistry). Pass ctx.modelRegistry from src/index.ts. Do not create ModelRuntime.

- [ ] **Step 4: Verify the boundary.** Run the same focused tests; expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add src/providers/types.ts src/config-manager.ts src/index.ts tests/config-manager.test.ts tests/helpers.ts
git commit -m "refactor: pass active model registry to providers"
```

## Task 2: Replace obsolete Codex tests with the OAuth contract

**Files:** Modify tests/providers/openai-codex.test.ts; delete tests/providers/openai-codex-mode-a.test.ts.

- [ ] **Step 1: Mock supported runtime APIs.** Mock the exact subpath before dynamically importing the provider:

```ts
const mockStream = vi.fn();
vi.doMock("@earendil-works/pi-ai/api/openai-codex-responses", () => ({
  stream: mockStream,
}));

const model = {
  id: "gpt-5.4",
  provider: "openai-codex",
  api: "openai-codex-responses",
} as Model<"openai-codex-responses">;

const modelRegistry = {
  find: vi.fn().mockReturnValue(model),
  isUsingOAuth: vi.fn().mockReturnValue(true),
  getApiKeyAndHeaders: vi.fn().mockResolvedValue({
    ok: true,
    apiKey: "oauth-token",
    headers: { "chatgpt-account-id": "acct" },
    env: { OPENAI_BASE_URL: "https://chatgpt.com/backend-api" },
  }),
} as unknown as ModelRegistry;
```

Make mockStream return an object whose result() resolves the existing submit_search_results fixture.

- [ ] **Step 2: Add success assertions.** Cover configured/default model lookup, exact stream options (apiKey, headers, env, signal, sse transport, minimal reasoning, low verbosity, onPayload), one normalized result, and two searches proving credentials are resolved on every search.

- [ ] **Step 3: Add table-driven rejection assertions.** Each case must reject rather than return []: missing registry; missing model; wrong API; isUsingOAuth false; auth failure; missing apiKey; error/aborted stream; missing tool call; zero normalized results; pre-aborted signal.

- [ ] **Step 4: Verify red tests.** Run pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts. Expected: failure against the current dual-mode/AuthStorage/fetch implementation.

## Task 3: Implement registry-backed Codex search

**Files:** Modify src/providers/openai-codex.ts.

- [ ] **Step 1: Replace imports and state.** Add these top-level imports:

```ts
import { hasApi } from "@earendil-works/pi-ai";
import { stream as streamOpenAICodexResponses } from "@earendil-works/pi-ai/api/openai-codex-responses";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
```

Remove AuthStorage, dynamic imports, direct Responses API fetch code, DEFAULT_MODEL_B, mode state, and mode-resolution methods. Retain the prompt, structured tool, payload injection, URL normalization, and result normalization.

- [ ] **Step 2: Update construction.** Accept (key?, providerConfig?, modelRegistry?), ignore key, retain configured model, store the registry, and keep requiresKey: false.

- [ ] **Step 3: Implement this search sequence.**

```ts
signal?.throwIfAborted();
if (!modelRegistry) throw new Error("Pi model registry unavailable");

const model = modelRegistry.find(
  "openai-codex",
  configuredModel ?? DEFAULT_MODEL,
);
if (!model || !hasApi(model, "openai-codex-responses")) {
  throw new Error("OpenAI Codex model is unavailable");
}
if (!modelRegistry.isUsingOAuth(model)) {
  throw new Error(
    "OpenAI Codex requires Pi OAuth; run /login for openai-codex",
  );
}

const auth = await modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) {
  throw new Error(
    "OpenAI Codex auth failed: " + auth.error + "; run /login for openai-codex",
  );
}
if (!auth.apiKey) {
  throw new Error("OpenAI Codex OAuth credentials are unavailable; run /login");
}

const message = await streamOpenAICodexResponses(model, context, {
  apiKey: auth.apiKey,
  headers: auth.headers,
  env: auth.env,
  signal,
  transport: "sse",
  reasoningEffort: "minimal",
  textVerbosity: "low",
  onPayload: injectCodexSearchPayload,
}).result();

if (message.stopReason === "aborted") {
  signal?.throwIfAborted();
  throw new Error("OpenAI Codex search aborted");
}
if (message.stopReason === "error") {
  throw new Error(
    "OpenAI Codex search failed: " + (message.errorMessage ?? "unknown error"),
  );
}

const submitCall = message.content.find(
  (block) =>
    block.type === "toolCall" && block.name === "submit_search_results",
);
if (!submitCall || submitCall.type !== "toolCall") {
  throw new Error("OpenAI Codex returned no structured search results");
}
const results = normalizeCodexToolCallResults(submitCall.arguments, maxResults);
if (results.length === 0) {
  throw new Error("OpenAI Codex returned no usable search results");
}
return results;
```

- [ ] **Step 4: Verify Codex behavior.** Run pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts; expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add src/providers/openai-codex.ts tests/providers/openai-codex.test.ts tests/providers/openai-codex-mode-a.test.ts
git commit -m "fix: resolve openai codex credentials through model registry"
```

## Task 4: Remove Codex API-key configuration and update docs

**Files:** Modify src/config.ts, tests/config.test.ts, tests/extract/config-video.test.ts, README.md, CHANGELOG.md.

- [ ] **Step 1: Remove the configuration path.** Delete "openai-codex": "OPENAI_API_KEY" from FALLBACK_ENV_MAP. Change the default Codex entry to exactly { enabled: true }. Leave openai-web-search unchanged.

- [ ] **Step 2: Update tests.** Remove Codex fallback assertions and assert the loaded default Codex entry has no apiKey.

- [ ] **Step 3: Update docs.** Describe Codex setup as Pi /login OAuth and direct OPENAI_API_KEY users to openai-web-search. Preserve the existing Codex example, which already has no apiKey. Add these Unreleased notes without changing historical entries:

```markdown
### Changed

- openai-codex now resolves Pi OAuth credentials through the active ModelRegistry and no longer uses an OpenAI API-key fallback.

### Fixed

- Codex authentication, stream, and empty-result failures now trigger provider fallback.
```

- [ ] **Step 4: Verify.** Run pnpm vitest run tests/config.test.ts tests/extract/config-video.test.ts tests/config-manager.test.ts tests/index.test.ts; expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add src/config.ts tests/config.test.ts tests/extract/config-video.test.ts README.md CHANGELOG.md
git commit -m "docs: document openai codex oauth configuration"
```

## Task 5: Repository verification

**Files:** None; verification only.

- [ ] **Step 1: Run focused regressions.**

```bash
pnpm vitest run \
  tests/providers/openai-codex.test.ts \
  tests/providers/openai-codex-helpers.test.ts \
  tests/config.test.ts \
  tests/extract/config-video.test.ts \
  tests/config-manager.test.ts \
  tests/index.test.ts \
  tests/session.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run pnpm check.** Expected: Biome, TypeScript, and the full Vitest suite pass.

- [ ] **Step 3: Run pnpm pack --dry-run.** Expected: updated provider source, README, and changelog are included; tests are not package contents.

- [ ] **Step 4: Review final state.**

```bash
git diff --check origin/master...HEAD
git status --short
```

Expected: no whitespace errors and only planned provider, config, tests, and documentation changes remain.

## Self-Review

- All referenced Pi APIs exist in the installed 0.80.10 dependency and current Pi main.
- OAuth is resolved per search and non-OAuth credentials are rejected.
- No duplicate runtime, AuthStorage path, direct fetch path, or Codex API-key fallback remains.
- Fallback-relevant failures reject instead of resolving to [].
- Helper normalization and search-hub normalization remain unchanged.
- No live credentialed request is required.
