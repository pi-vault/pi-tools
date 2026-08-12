# TinyFish Search + Fetch Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TinyFish as a tier-2 provider for the existing `web_search` and `web_fetch` tools.

**Architecture:** Add one dedicated `TinyFishProvider` using Node's native `fetch` and TinyFish's canonical Search and Fetch REST endpoints. Register it through pi-tools' existing `ProviderMeta`/`ProviderRegistry` seams so fallback, fusion, budgets, dashboard discovery, credentials, and automatic selection require no new infrastructure. This is not a Pi `ExtensionAPI.registerProvider()` model-provider integration; Pi continues to load the unchanged pi-tools extension and its existing `web_search`/`web_fetch` tools.

**Tech Stack:** TypeScript, native `fetch`, Vitest, Biome, existing Pi Tools provider/configuration APIs.

---

## File map

- Create `src/providers/tinyfish.ts`: TinyFish Search/Fetch HTTP client and `ProviderMeta`.
- Create `tests/providers/tinyfish.test.ts`: mocked TinyFish request/response contract tests.
- Modify `src/providers/all.ts`: include TinyFish in the provider registry barrel.
- Modify `src/config.ts`: add the default provider entry and `TINYFISH_API_KEY` fallback mapping.
- Modify `tests/providers/all.test.ts`: update provider count/name expectations.
- Modify `tests/config.test.ts`: update built-in budget and environment mapping expectations.
- Modify `tests/config-manager.test.ts`: verify the resolved TinyFish key registers both capabilities through the real metadata path.
- Modify `README.md`: document TinyFish setup, capabilities, and configuration.
- Modify `CHANGELOG.md`: add the Unreleased provider entry.

## Decisions locked by the design

- V1 supports TinyFish Search and Fetch only; Agent and Browser APIs are out of scope.
- Provider name is `tinyfish`; display label is `TinyFish`.
- Tier is `2`, so configured TinyFish participates in automatic selection after tier-1 providers.
- API key is required and resolves through `TINYFISH_API_KEY`.
- Built-in budget is `{ mode: "unlimited" }`; TinyFish documents Search and Fetch as non-credit APIs, while upstream rate-limit errors remain ordinary provider failures.
- Search uses the documented first page and slices results locally to `maxResults`; no pagination changes are introduced.
- Existing single-URL `FetchProvider.fetch()` is retained even though TinyFish supports batch Fetch.
- No SDK, dependency, endpoint override, retry layer, new tool, generic adapter change, or Pi core change.

### Task 1: Add failing TinyFish provider contract tests

**Files:**

- Create: `tests/providers/tinyfish.test.ts`

- [ ] **Step 1: Add metadata and Search request tests**

Use the existing `stubFetch` helper and assert the exact public contract:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TinyFishProvider,
  providerMeta,
} from "../../src/providers/tinyfish.ts";
import { stubFetch } from "../helpers.ts";

describe("TinyFishProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has the expected metadata", () => {
    const provider = new TinyFishProvider("key");
    expect(provider.name).toBe("tinyfish");
    expect(provider.label).toBe("TinyFish");
    expect(providerMeta).toMatchObject({
      name: "tinyfish",
      tier: 2,
      requiresKey: true,
    });
    expect(providerMeta.create("key").search).toBeDefined();
    expect(providerMeta.create("key").fetch).toBeDefined();
  });

  it("sends the API key and maps Search filters", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: { results: [] },
    });

    await new TinyFishProvider("tiny-key").search("pi tools", 5, undefined, {
      includeDomains: ["github.com", "docs.example.com"],
      excludeDomains: ["spam.example.com"],
      startDate: "2026-01-01",
      endDate: "2026-08-12",
    });

    const [input, init] = (globalThis.fetch as any).mock.calls[0];
    const url = new URL(input as string);
    expect(url.origin + url.pathname).toBe("https://api.search.tinyfish.ai/");
    expect(url.searchParams.get("query")).toBe("pi tools");
    expect(url.searchParams.get("include_domains")).toBe(
      "github.com,docs.example.com",
    );
    expect(url.searchParams.get("exclude_domains")).toBe("spam.example.com");
    expect(url.searchParams.get("after_date")).toBe("2026-01-01");
    expect(url.searchParams.get("before_date")).toBe("2026-08-12");
    expect(init.headers["X-API-Key"]).toBe("tiny-key");
    expect(init.headers.Accept).toBe("application/json");
  });
});
```

- [ ] **Step 2: Add Search normalization and failure tests**

Add tests for the documented `{ results: [{ title, snippet, url }] }` response:

- return normalized `SearchResult` values;
- discard non-HTTP URLs and cap output to `maxResults`;
- throw an error containing `TinyFish search error` for a 429 response.

Use a fixture with two valid results and one `javascript:` result, call `search("test", 1)`, and assert exactly one valid result is returned.

- [ ] **Step 3: Add Fetch request, response, and partial-error tests**

Add tests asserting:

```ts
fetchStub.addResponse("api.fetch.tinyfish.ai", {
  body: {
    results: [
      {
        url: "https://example.com",
        title: "Example",
        text: "# Example\n\nFetched markdown",
        format: "markdown",
      },
    ],
    errors: [],
  },
});

const result = await new TinyFishProvider("tiny-key").fetch(
  "https://example.com",
);
expect(result).toEqual({
  text: "# Example\n\nFetched markdown",
  title: "Example",
  contentType: "text/markdown",
});

const [input, init] = (globalThis.fetch as any).mock.calls[0];
expect(input).toBe("https://api.fetch.tinyfish.ai");
expect(init.method).toBe("POST");
expect(JSON.parse(init.body)).toEqual({
  urls: ["https://example.com"],
  format: "markdown",
});
expect(init.headers["X-API-Key"]).toBe("tiny-key");
```

Also test that a response with no matching result and an `errors` entry throws an error containing that URL/error, and that a non-2xx response throws `TinyFish fetch error`.

- [ ] **Step 4: Add abort-signal forwarding test**

Call `search` with an `AbortController.signal`, inspect the mocked fetch call, and assert `init.signal` is the same signal object.

- [ ] **Step 5: Run the focused tests and confirm they fail**

Run:

```bash
pnpm exec vitest run tests/providers/tinyfish.test.ts
```

Expected: collection/import failure because `src/providers/tinyfish.ts` does not yet exist.

### Task 2: Implement the native TinyFish provider

**Files:**

- Create: `src/providers/tinyfish.ts`
- Test: `tests/providers/tinyfish.test.ts`

- [ ] **Step 1: Implement response guards and URL normalization**

Add local helpers without changing shared provider types:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
```

Use these helpers when converting unknown JSON into local provider results. Do not use `any` in production code.

- [ ] **Step 2: Implement Search with native fetch**

Build the request against `https://api.search.tinyfish.ai` using `URL`/`URLSearchParams`:

```ts
const url = new URL("https://api.search.tinyfish.ai");
url.searchParams.set("query", query);
if (filters?.includeDomains?.length) {
  url.searchParams.set("include_domains", filters.includeDomains.join(","));
}
if (filters?.excludeDomains?.length) {
  url.searchParams.set("exclude_domains", filters.excludeDomains.join(","));
}
if (filters?.startDate) url.searchParams.set("after_date", filters.startDate);
if (filters?.endDate) url.searchParams.set("before_date", filters.endDate);

const response = await fetch(url, {
  headers: { Accept: "application/json", "X-API-Key": this.apiKey },
  signal,
});
if (!response.ok) {
  throw new Error(
    `TinyFish search error: ${response.status} ${response.statusText}`,
  );
}
```

Parse `results` only when it is an array. Map string title/snippet values to empty strings when absent, discard records whose URL is not HTTP(S), and return `.slice(0, maxResults)`.

- [ ] **Step 3: Implement Fetch with native fetch**

Send the documented Markdown request:

```ts
const response = await fetch("https://api.fetch.tinyfish.ai", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-Key": this.apiKey,
  },
  body: JSON.stringify({ urls: [url], format: "markdown" }),
  signal,
});
if (!response.ok) {
  throw new Error(
    `TinyFish fetch error: ${response.status} ${response.statusText}`,
  );
}
```

For the existing single-URL interface, use the first usable result. TinyFish documents `results[].url` as the original requested URL and `final_url` as the post-redirect URL, so no redirect matching or URL rewriting is needed in the local `FetchResult`. Return its string `text`, optional string `title`, and `contentType: "text/markdown"`.

If there is no usable result, inspect `errors` for `errors[].url === url` and throw `TinyFish fetch error: <error>`; otherwise throw `TinyFish fetch error: no result for <url>`. Preserve the caller's signal and do not retry.

- [ ] **Step 4: Add provider metadata**

Export:

```ts
export const providerMeta: ProviderMeta = {
  name: "tinyfish",
  tier: 2,
  requiresKey: true,
  create: (key) => {
    const provider = new TinyFishProvider(key!);
    return { search: provider, fetch: provider };
  },
};
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/providers/tinyfish.test.ts
pnpm exec tsc --noEmit
```

Expected: both commands pass.

### Task 3: Register TinyFish and add configuration defaults

**Files:**

- Modify: `src/providers/all.ts`
- Modify: `src/config.ts`
- Modify: `tests/providers/all.test.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/config-manager.test.ts`

- [ ] **Step 1: Register the provider barrel entry**

Add:

```ts
import { providerMeta as tinyfish } from "./tinyfish.ts";
```

and append `tinyfish` to `allProviders`.

- [ ] **Step 2: Add credential fallback mapping**

Add to `FALLBACK_ENV_MAP`:

```ts
tinyfish: "TINYFISH_API_KEY",
```

This preserves the existing `resolveProviderKey()` fallback path. `ConfigManager` registers the provider from `DEFAULT_CONFIG.providers.tinyfish.apiKey` and resolves that configured environment-variable name through `resolveApiKey()`; the fallback map is kept consistent for callers that use the provider-name lookup path.

- [ ] **Step 3: Add built-in provider defaults**

Add to `DEFAULT_CONFIG.providers`:

```ts
tinyfish: {
  enabled: true,
  budget: { mode: "unlimited" },
  apiKey: "TINYFISH_API_KEY",
},
```

- [ ] **Step 4: Update provider barrel tests**

Update `tests/providers/all.test.ts` to:

- change the expected provider count from `22` to `23`;
- add `tinyfish` to the expected provider names;
- keep the custom-cost provider list unchanged because TinyFish uses the default unit cost behavior.

- [ ] **Step 5: Update config tests**

Update `tests/config.test.ts` to:

- expect `tinyfish: { mode: "unlimited" }` in the built-in budget map;
- add `tinyfish` to the expected fallback provider list;
- assert `FALLBACK_ENV_MAP.tinyfish === "TINYFISH_API_KEY"`.

- [ ] **Step 6: Cover ConfigManager registration with the real TinyFish metadata**

Extend `tests/config-manager.test.ts` with a focused test that:

- loads a config containing an enabled `tinyfish` entry whose `apiKey` is `TINYFISH_API_KEY`;
- stubs `resolveApiKey("TINYFISH_API_KEY")` to return a test key;
- constructs `ConfigManager` with the real TinyFish `providerMeta` and a fresh `ProviderRegistry`;
- asserts `registerProvider` receives the TinyFish name, tier-2 policy, and instances containing both `search` and `fetch`.

This verifies the runtime registration path used during Pi session startup without calling TinyFish.

- [ ] **Step 7: Run registration/config tests**

Run:

```bash
pnpm exec vitest run tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts tests/providers/tinyfish.test.ts
```

Expected: all tests pass.

### Task 4: Document TinyFish setup and release notes

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the provider capability row**

Add to the README provider table:

```markdown
| TinyFish | Search, fetch | `TINYFISH_API_KEY` |
```

- [ ] **Step 2: Add TinyFish to the configuration example**

Add to the full configuration reference:

```json
"tinyfish": {
  "enabled": true,
  "apiKey": "TINYFISH_API_KEY"
}
```

Add a short setup note near the provider documentation explaining that TinyFish uses the Search and Fetch REST APIs and requires an API key.

- [ ] **Step 3: Add the Unreleased changelog entry**

Under `## [Unreleased]`, add:

```markdown
### Added

- Added TinyFish Search and Fetch provider support through `TINYFISH_API_KEY`.
```

If an `### Added` subsection already exists, append to it instead of duplicating it.

- [ ] **Step 4: Check documentation whitespace**

Run:

```bash
git diff --check
```

Expected: no whitespace errors. Markdown is intentionally excluded from this repository's Biome configuration; TypeScript remains covered by `pnpm check`.

### Task 5: Run full verification and self-review

**Files:**

- Verify all files changed by Tasks 1–4.

- [ ] **Step 1: Run the complete project check**

Run:

```bash
pnpm check
```

Expected: Biome lint, TypeScript, and all Vitest tests pass.

- [ ] **Step 2: Verify the package contents without publishing**

Run:

```bash
pnpm pack:dry-run
```

Expected: the package includes `src/providers/tinyfish.ts`, tests are excluded according to the existing package configuration, and no new dependency is listed.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/providers/tinyfish.ts src/providers/all.ts src/config.ts tests/providers/tinyfish.test.ts tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts README.md CHANGELOG.md
```

Confirm that only the planned provider, tests, configuration, and documentation files changed; there are no lockfile or dependency changes.

- [ ] **Step 4: Complete the implementation handoff**

Report the passing commands and note that live TinyFish API verification was not required. Do not claim live connectivity or upstream availability based solely on mocked tests.

## Self-review result

- Spec coverage: Search, Fetch, authentication, tier, budget, config, fallback, ConfigManager registration, normalization, errors, cancellation, tests, docs, and verification are each assigned to a task.
- Placeholder scan: no unfinished markers or unspecified implementation steps remain.
- Type consistency: `TinyFishProvider` implements the existing `SearchProvider` and `FetchProvider` methods; `providerMeta.create()` returns the capabilities expected by `ProviderMeta`.
- Scope check: one provider integration only; TinyFish Agent/Browser work is explicitly excluded.
