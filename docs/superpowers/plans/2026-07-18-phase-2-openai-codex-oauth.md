# OpenAI Codex OAuth Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make `openai-codex` use Pi-managed OAuth credentials through the active `ModelRegistry` and reject failures so provider fallback works.

**Architecture:** The existing extension context owns the ModelRegistry, so provider factories receive that instance instead of creating a second runtime or reading AuthStorage directly. Codex resolves the configured model and refreshed credentials for every search, streams through Pi AI, and throws on unusable responses. `openai-web-search` remains the API-key-backed alternative.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` `ModelRegistry`, Vitest, Biome, pnpm.

---

## File Map

- Modify `src/providers/types.ts`, `src/config-manager.ts`, and `src/index.ts` to pass the active registry into provider factories.
- Modify `src/providers/openai-codex.ts` to remove AuthStorage/direct-fetch modes and use registry auth plus Pi streaming.
- Modify Codex/config/index tests; delete `tests/providers/openai-codex-mode-a.test.ts`.
- Modify `src/config.ts`, `tests/config.test.ts`, `tests/extract/config-video.test.ts`, `README.md`, and `CHANGELOG.md` for the Codex API-key removal.

## Task 1: Add the ModelRegistry factory boundary

**Files:**

- Modify: `src/providers/types.ts`, `src/config-manager.ts`, `src/index.ts`
- Test: `tests/config-manager.test.ts`, `tests/index.test.ts`, `tests/helpers.ts`

- [ ] **Step 1: Add a failing propagation test.**

Create a mocked registry and a `create` spy. Because the test provider has no configured key, assert the actual first argument is `undefined`, the second argument is the SSRF-augmented config, and the third is the same registry object:

```ts
const modelRegistry = {} as ModelRegistry;
const create = vi.fn().mockReturnValue({ search: vi.fn() });
const meta = makeMeta("brave", { create });
new ConfigManager("/test/cwd", registry, [meta], modelRegistry);
expect(create).toHaveBeenCalledWith(
  undefined,
  expect.objectContaining({ ssrfAllowRanges: [] }),
  modelRegistry,
);
```

Add a minimal `modelRegistry` field to `makeCtx` so `initializeSession` matches the current Pi `ExtensionContext` type.

- [ ] **Step 2: Run the boundary tests and verify failure.**

Run: `pnpm vitest run tests/config-manager.test.ts tests/index.test.ts`

Expected: FAIL because the constructor and factory call do not accept or forward a registry.

- [ ] **Step 3: Implement the pass-through interface.**

Add an optional third parameter to `ProviderMeta.create`:

```ts
create: (
  key?: string,
  providerConfig?: ProviderConfigEntry,
  modelRegistry?: ModelRegistry,
) => ProviderInstances;
```

Add an optional fourth `modelRegistry?: ModelRegistry` constructor argument to `ConfigManager`, store it, and pass it to `meta.create(resolvedKey, configWithSsrf, this.modelRegistry)`. Pass `ctx.modelRegistry` from `src/index.ts`. Use type-only imports and do not instantiate `ModelRuntime` here.

- [ ] **Step 4: Run the boundary tests.**

Run: `pnpm vitest run tests/config-manager.test.ts tests/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the boundary.**

```bash
git add src/providers/types.ts src/config-manager.ts src/index.ts tests/config-manager.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "refactor: pass active model registry to providers"
```

## Task 2: Define the OAuth-only Codex contract in tests

**Files:**

- Modify: `tests/providers/openai-codex.test.ts`
- Keep: `tests/providers/openai-codex-helpers.test.ts`
- Delete: `tests/providers/openai-codex-mode-a.test.ts`

- [ ] **Step 1: Replace obsolete AuthStorage/runtime mocks.**

Mock `ModelRegistry.find` and `getApiKeyAndHeaders`, plus `streamOpenAICodexResponses`:

```ts
const model = {
  id: "gpt-5.4",
  provider: "openai-codex",
  api: "openai-codex-responses",
} as Model<"openai-codex-responses">;
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

Make the mocked stream return `{ result: vi.fn().mockResolvedValue(message) }` with the existing structured tool-call fixture.

- [ ] **Step 2: Add failing success-path assertions.**

Assert configured model lookup, per-search credential lookup, one normalized result, and exact stream options including `apiKey`, `headers`, `env`, `signal`, `transport: "sse"`, minimal reasoning, low verbosity, and `onPayload`.

- [ ] **Step 3: Add failing rejection-path assertions.**

Assert rejection for an unavailable registry, missing model, wrong model API, `{ ok: false, error }` auth, missing `apiKey`, `error`/`aborted` stream messages, missing `submit_search_results`, and zero normalized results. These must reject rather than resolve to `[]`, because `executeWithFallback` advances only after rejection.

- [ ] **Step 4: Run Codex tests and verify failure.**

Run: `pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts`

Expected: FAIL because the current implementation uses dual modes, AuthStorage, direct fetch, and empty-array failures.

## Task 3: Implement registry-backed Codex search

**Files:**

- Modify: `src/providers/openai-codex.ts`

- [ ] **Step 1: Remove obsolete mode state and direct API code.**

Delete `DEFAULT_MODEL_B`, the Responses endpoint, AuthStorage types/imports, direct fetch parsing, dual-mode state, and mode-specific search methods. Retain the structured tool, context prompt, payload injection, URL normalization, and Codex result normalization.

- [ ] **Step 2: Update provider construction.**

Accept `(key, providerConfig, modelRegistry)`; ignore `key`, retain the configured model, and keep `requiresKey: false`. Import `ModelRegistry` as a type and use Pi AI’s `hasApi` and `streamOpenAICodexResponses` for runtime behavior.

- [ ] **Step 3: Implement the search flow.**

Use this sequence on every search:

```ts
signal?.throwIfAborted();
if (!modelRegistry) throw new Error("Pi model registry unavailable");
const model = modelRegistry.find(
  "openai-codex",
  configuredModel ?? DEFAULT_MODEL_A,
);
if (!model || !hasApi(model, "openai-codex-responses")) {
  throw new Error("OpenAI Codex model is unavailable");
}
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
}).result();
```

Throw descriptive errors for `error`/`aborted` stop reasons, missing tool calls, and zero normalized results. Return normalized results only after a valid structured tool call.

- [ ] **Step 4: Run Codex tests.**

Run: `pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts`

Expected: PASS with no direct fetch or API-key fallback path.

- [ ] **Step 5: Commit Codex behavior.**

```bash
git add src/providers/openai-codex.ts tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts tests/providers/openai-codex-mode-a.test.ts
git commit -m "fix: resolve openai codex credentials through model registry"
```

## Task 4: Remove Codex API-key configuration and document Phase 2

**Files:**

- Modify: `src/config.ts`, `tests/config.test.ts`, `tests/extract/config-video.test.ts`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Remove Codex fallback configuration.**

Delete `openai-codex` from `FALLBACK_ENV_MAP`. Change its default entry to `{ enabled: true }` with no `apiKey` field. Leave `openai-web-search` as the API-key-backed provider.

- [ ] **Step 2: Update config tests.**

Remove expectations for the Codex fallback mapping from `tests/config.test.ts` and `tests/extract/config-video.test.ts`. Assert in `tests/config.test.ts` that the default Codex entry has no `apiKey`.

- [ ] **Step 3: Update user-facing documentation.**

Describe Codex as Pi OAuth-authenticated search and direct API-key users to `openai-web-search`. Add an Unreleased changelog entry for OAuth resolution, removal of the Codex API-key fallback, and fallback-triggering errors. Preserve historical entries.

- [ ] **Step 4: Run focused and repository checks.**

Run:

```bash
pnpm vitest run tests/providers/openai-codex.test.ts tests/providers/openai-codex-helpers.test.ts tests/config.test.ts tests/extract/config-video.test.ts tests/config-manager.test.ts tests/index.test.ts tests/session.test.ts
pnpm check
pnpm pack --dry-run
git diff --check origin/master...HEAD
```

Expected: all tests and checks pass; the package contains the updated provider source and no obsolete Codex mode test.

- [ ] **Step 5: Commit configuration and docs.**

```bash
git add src/config.ts tests/config.test.ts tests/extract/config-video.test.ts README.md CHANGELOG.md
git commit -m "docs: document openai codex oauth configuration"
```

## Self-Review

- Active `ModelRegistry` is reused; no duplicate `ModelRuntime` is created.
- Auth is resolved per search so refreshed OAuth credentials are honored.
- `.result()` is awaited on the Pi AI event stream.
- All fallback-relevant failures reject instead of silently stopping fallback with `[]`.
- The search-hub normalization enhancements are explicitly out of scope.
