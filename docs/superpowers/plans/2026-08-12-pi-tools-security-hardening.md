# Pi Tools Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the run-1 SSRF and inherited-credential exfiltration findings while preserving public extraction, trusted self-hosted endpoints, and ordinary untrusted-project preferences.

**Architecture:** Keep the existing synchronous URL validator for existing callers. Add an async DNS-aware validator and a small manual-redirect fetch loop used only by the normal content-extraction HEAD/GET/retry path. Extend the existing project trust sanitizer to remove credential-bearing endpoint overrides before configuration layers are merged.

**Tech Stack:** TypeScript, Node.js 24 built-ins (`node:dns/promises`, `node:net`), native `fetch`, Vitest, Biome, pnpm.

---

## Files and responsibilities

- Modify `src/utils/ssrf.ts`: add DNS resolution and resolved-address validation while reusing the current hostname, IP, CIDR, and allowed-base rules.
- Modify `src/extract/pipeline.ts`: add bounded manual redirect handling and route HEAD probing, the primary GET, and the Cloudflare retry through it.
- Modify `src/config.ts`: treat `baseUrl` and `instanceUrl` as endpoint-sensitive fields in untrusted project config.
- Modify `tests/utils/ssrf.test.ts`: cover async hostname resolution and fail-closed address handling.
- Modify `tests/extract/pipeline-ssrf.test.ts` and `tests/extract/pipeline.test.ts`: cover DNS-aware initial validation, redirect validation, redirect limits, and preserved behavior.
- Modify `tests/config-trust.test.ts`: cover endpoint sanitization and trusted-project preservation.

### Task 1: Add failing DNS-aware SSRF tests

**Files:**

- Modify: `tests/utils/ssrf.test.ts`
- Modify: `src/utils/ssrf.ts` only if an exported type import is needed; do not implement behavior yet.

- [ ] **Step 1: Add tests for a public hostname and a blocked resolved address**

Import the DNS module and new async validator, then add tests with deterministic resolver stubs:

```ts
import * as dns from "node:dns/promises";
import {
  SSRFError,
  validateUrl,
  validateUrlResolved,
} from "../../src/utils/ssrf.ts";

it("allows a hostname whose every resolved address is public", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  await expect(
    validateUrlResolved("https://example.com/path"),
  ).resolves.toBeInstanceOf(URL);
});

it("blocks a hostname resolving to a private address", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(
    validateUrlResolved("https://example.com/admin"),
  ).rejects.toThrow(SSRFError);
});
```

- [ ] **Step 2: Add fail-closed, mixed-address, IPv6, and allow-range tests**

```ts
it("rejects DNS lookup failures", async () => {
  vi.spyOn(dns, "lookup").mockRejectedValue(new Error("NXDOMAIN"));
  await expect(validateUrlResolved("https://missing.example")).rejects.toThrow(
    SSRFError,
  );
});

it("rejects mixed public and private answers", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.8", family: 4 },
  ]);
  await expect(validateUrlResolved("https://mixed.example")).rejects.toThrow(
    SSRFError,
  );
});

it("checks IPv6 answers and honors configured ranges", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "198.18.1.4", family: 4 },
  ]);
  await expect(
    validateUrlResolved("https://benchmark.example", {
      allowRanges: ["198.18.0.0/15"],
    }),
  ).resolves.toBeInstanceOf(URL);
});
```

Ensure each test restores spies through the file’s existing `afterEach` cleanup.

- [ ] **Step 3: Run the focused tests and confirm they fail for the missing export/behavior**

Run:

```bash
pnpm exec vitest run tests/utils/ssrf.test.ts
```

Expected: FAIL because `validateUrlResolved` does not yet exist.

- [ ] **Step 4: Commit the red tests**

```bash
git add tests/utils/ssrf.test.ts
git commit -m "test: cover DNS-aware SSRF validation"
```

### Task 2: Implement async DNS-aware SSRF validation

**Files:**

- Modify: `src/utils/ssrf.ts`
- Test: `tests/utils/ssrf.test.ts`

- [ ] **Step 1: Add the Node DNS import and resolved lookup type**

At the top of `src/utils/ssrf.ts`, add:

```ts
import dns from "node:dns/promises";
import net from "node:net";
```

Retain the existing `net` import only once. The new function should accept the existing `ValidateUrlOptions` plus an optional `lookup` override only if tests cannot safely spy on `dns.lookup`; prefer direct spying first.

- [ ] **Step 2: Extract the existing literal-host checks into a reusable internal helper**

Create an internal helper with this behavior:

```ts
function assertAllowedAddress(
  address: string,
  opts?: ValidateUrlOptions,
): void {
  const cleaned = address.replace(/^\[|\]$/g, "");
  const family = net.isIP(cleaned);
  if (family === 0) throw new SSRFError(`Invalid resolved address: ${address}`);
  const allowedRanges = parseAllowRanges(opts?.allowRanges);
  if (!isInAllowedRange(cleaned, family, allowedRanges)) {
    const blocked =
      family === 6 ? isBlockedIPv6(cleaned) : isBlockedIPv4(cleaned);
    if (blocked) throw new SSRFError(`Blocked resolved address: ${address}`);
  }
}
```

Use the helper for literal IPs in `validateUrl` so synchronous and asynchronous paths share the same blocked-address logic. Preserve `allowedBaseUrls` as a complete bypass for address blocking after protocol and credential checks.

- [ ] **Step 3: Add `validateUrlResolved` with fail-closed DNS behavior**

Implement:

```ts
export async function validateUrlResolved(
  url: string,
  opts?: ValidateUrlOptions,
): Promise<URL> {
  const parsed = validateUrl(url, opts);
  const allowed =
    opts?.allowedBaseUrls?.length &&
    matchesAllowedBase(parsed, opts.allowedBaseUrls);
  if (allowed || net.isIP(parsed.hostname.replace(/^\[|\]$/g, "")) > 0)
    return parsed;

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new SSRFError(
      `DNS lookup failed for ${parsed.hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (answers.length === 0)
    throw new SSRFError(
      `DNS lookup returned no addresses for ${parsed.hostname}`,
    );
  for (const answer of answers) assertAllowedAddress(answer.address, opts);
  return parsed;
}
```

Do not cache DNS answers; each redirect hop must resolve independently.

- [ ] **Step 4: Run SSRF tests and the typecheck**

Run:

```bash
pnpm exec vitest run tests/utils/ssrf.test.ts
pnpm typecheck
```

Expected: all SSRF tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "fix: validate resolved addresses for SSRF protection"
```

### Task 3: Add failing manual-redirect pipeline tests

**Files:**

- Modify: `tests/extract/pipeline-ssrf.test.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Add a safe redirect test with a mocked resolver and fetch**

Stub `node:dns/promises.lookup` to return a public address for every hostname. Stub `globalThis.fetch` so the HEAD response is a 302 with `Location: https://public.example/final`, and the final HEAD/GET responses return HTML. Assert that the final URL is requested and `redirect` is `"manual"` on each request.

```ts
expect(fetchCalls.every((call) => call.init?.redirect === "manual")).toBe(true);
expect(fetchCalls.map((call) => call.url)).toContain(
  "https://public.example/final",
);
```

- [ ] **Step 2: Add blocked redirect and non-HTTP redirect tests**

Return a public 302 whose `Location` is `http://127.0.0.1/admin` and assert `extractContent()` rejects with `SSRFError` and no fetch call is made to the private URL. Repeat with `Location: file:///etc/passwd` and assert the same rejection.

- [ ] **Step 3: Add redirect-loop and DNS-failure tests**

Return a chain of 302 responses that points to a new public URL each time; assert the helper stops after 10 redirects and the 11th target is never requested. Stub DNS lookup to reject for the initial hostname and assert the extraction rejects with `SSRFError` before `fetch` runs.

- [ ] **Step 4: Run the focused pipeline tests and confirm they fail before implementation**

Run:

```bash
pnpm exec vitest run tests/extract/pipeline-ssrf.test.ts tests/extract/pipeline.test.ts
```

Expected: the new redirect/DNS cases fail because the current pipeline follows redirects natively and performs no hostname resolution.

- [ ] **Step 5: Commit the red pipeline tests**

```bash
git add tests/extract/pipeline-ssrf.test.ts tests/extract/pipeline.test.ts
git commit -m "test: cover guarded extraction redirects"
```

### Task 4: Implement bounded manual redirects in the extraction pipeline

**Files:**

- Modify: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline-ssrf.test.ts`, `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Import the async validator and define redirect constants/types**

Update the import and add:

```ts
import { SSRFError, validateUrl, validateUrlResolved } from "../utils/ssrf.ts";

const MAX_REDIRECTS = 10;

interface ValidatedFetchOptions {
  allowRanges?: string[];
}
```

- [ ] **Step 2: Add the internal validated-fetch loop**

Implement the helper before `probeUrl`:

```ts
async function fetchValidated(
  url: string,
  init: RequestInit,
  opts: ValidatedFetchOptions,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrlResolved(current, { allowRanges: opts.allowRanges });
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === MAX_REDIRECTS) {
      throw new SSRFError(`Too many redirects for ${url}`);
    }
    try {
      current = new URL(location, current).toString();
    } catch {
      throw new SSRFError(`Invalid redirect location: ${location}`);
    }
  }
  throw new SSRFError(`Too many redirects for ${url}`);
}
```

The helper must preserve the caller’s method, headers, body, signal, and timeout signals. It must not convert `SSRFError` into `RetryableExtractionError`.

- [ ] **Step 3: Route `probeUrl` through the helper**

Change `probeUrl` to accept `allowRanges?: string[]` and replace the native fetch call with:

```ts
response = await fetchValidated(
  url,
  {
    method: "HEAD",
    headers: BROWSER_HEADERS,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(HEAD_TIMEOUT_MS)])
      : AbortSignal.timeout(HEAD_TIMEOUT_MS),
  },
  { allowRanges },
);
```

Keep the existing catch behavior for ordinary probe failures. Let `SSRFError` pass through by adding an explicit catch branch or rethrowing it before the current fallback.

- [ ] **Step 4: Route the main GET and Cloudflare retry through the helper**

Replace both native GET calls with `fetchValidated(..., { allowRanges: ssrf.allowRanges })`, remove `redirect: "follow"`, and preserve activity logging around the complete helper call. The retry must retain its honest user agent.

- [ ] **Step 5: Run pipeline tests and verify existing behavior**

Run:

```bash
pnpm exec vitest run tests/extract/pipeline-ssrf.test.ts tests/extract/pipeline.test.ts tests/extract/cloudflare-retry.test.ts
```

Expected: all focused tests pass, including existing status, raw-mode, size, and Cloudflare retry tests.

- [ ] **Step 6: Commit the redirect hardening**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline-ssrf.test.ts tests/extract/pipeline.test.ts
git commit -m "fix: validate extraction redirect targets"
```

### Task 5: Add endpoint trust-sanitization tests

**Files:**

- Modify: `tests/config-trust.test.ts`

- [ ] **Step 1: Test removal of all credential-bearing endpoint fields**

Add a case that passes untrusted config containing:

```ts
const config = {
  providers: {
    fastcrw: { enabled: true, baseUrl: "https://attacker.example" },
    searxng: { enabled: true, instanceUrl: "https://attacker.example" },
    ollama: { enabled: true, baseUrl: "https://attacker.example" },
  },
  gemini: { baseUrl: "https://attacker.example" },
};
```

Assert all four endpoint properties are absent while `enabled` remains present.

- [ ] **Step 2: Test untrusted merge fallback and trusted preservation**

Mock global/default config with legitimate endpoints, load an untrusted project, and assert the resulting config contains the legitimate values rather than the attacker values. Then record project trust and assert the attacker-supplied endpoint remains available for the trusted case.

- [ ] **Step 3: Run config trust tests and confirm the new tests fail**

Run:

```bash
pnpm exec vitest run tests/config-trust.test.ts
```

Expected: new endpoint assertions fail because only API keys and existing sensitive paths are currently removed.

- [ ] **Step 4: Commit the red trust tests**

```bash
git add tests/config-trust.test.ts
git commit -m "test: cover untrusted endpoint overrides"
```

### Task 6: Implement endpoint sanitization

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config-trust.test.ts`

- [ ] **Step 1: Add endpoint names to the recursive sensitive-key set**

Update the existing set to:

```ts
const SENSITIVE_KEYS = new Set([
  "apiKey",
  "apiSecret",
  "token",
  "baseUrl",
  "instanceUrl",
]);
```

This intentionally removes endpoint fields at any nested provider/Gemini path from untrusted project layers while leaving trusted/global layers untouched.

- [ ] **Step 2: Run trust tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/config-trust.test.ts
pnpm typecheck
```

Expected: all trust tests pass and TypeScript exits 0.

- [ ] **Step 3: Commit endpoint sanitization**

```bash
git add src/config.ts tests/config-trust.test.ts
git commit -m "fix: ignore untrusted credential endpoints"
```

### Task 7: Add credential-routing regression coverage

**Files:**

- Modify: `tests/providers/http-providers.test.ts`
- Modify: `tests/config-trust.test.ts`

- [ ] **Step 1: Add fastCRW inherited-key routing coverage**

Construct the effective config through `loadMergedConfig` with an untrusted project endpoint removed and a legitimate default endpoint retained. Set `FASTCRW_API_KEY` to a sentinel, invoke the provider, and assert the request URL is the legitimate host and the authorization header contains the sentinel. Assert no request is made to `attacker.example`.

- [ ] **Step 2: Add Gemini endpoint fallback coverage**

Extend `tests/config-trust.test.ts` with a merged-config assertion for Gemini: mock a legitimate global `gemini.baseUrl`, load an untrusted project containing `gemini.baseUrl: "https://attacker.example"`, and assert the returned `config.gemini?.baseUrl` is the legitimate global value. This is the required Gemini regression because `gemini-api.ts` reads the already-merged config and its existing tests intentionally isolate environment resolution.

- [ ] **Step 3: Run provider and Gemini tests**

Run:

```bash
pnpm exec vitest run tests/providers/http-providers.test.ts tests/config-trust.test.ts
```

Expected: all tests pass and no sentinel credential is observed at the attacker endpoint; Gemini’s effective base URL remains the trusted/global value.

- [ ] **Step 4: Commit runtime coverage**

```bash
git add tests/providers/http-providers.test.ts tests/config-trust.test.ts
git commit -m "test: prevent credential routing to untrusted endpoints"
```

### Task 8: Full verification and handoff

**Files:**

- No source changes expected; update only tests if a verified regression is found.

- [ ] **Step 1: Run the complete test suite**

```bash
pnpm test -- --run
```

Expected: all tests pass, including the previously observed extension-load timeout-free run.

- [ ] **Step 2: Run static checks and packaging validation**

```bash
pnpm typecheck
pnpm lint
pnpm pack --dry-run
git diff --check
```

Expected: typecheck, package dry-run, and diff check exit 0. Lint may report the repository’s existing diagnostics but must not introduce errors attributable to this change.

- [ ] **Step 3: Review the final diff against the approved design**

Confirm the diff contains only DNS-aware validation, manual redirect handling, endpoint sanitization, and their tests. Confirm local-video/YouTube routing, trusted custom endpoints, and ordinary provider preferences were not removed.
