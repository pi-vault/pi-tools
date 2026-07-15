# Phase 1: Cloudflare Bot Retry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry once with an honest User-Agent when Cloudflare issues a 403 with `cf-mitigated: challenge` header.

**Architecture:** Insert a single retry check in `pipeline.ts` after the initial HTTP response, before the `!response.ok` error handling. Phase 1b (Cloudflare AI Gateway) is already implemented in `gemini-api.ts` with tests — no work needed.

**Tech Stack:** TypeScript, Vitest, native `fetch`

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 1)

---

### Task 1: Write failing test for Cloudflare bot retry

**Files:**
- Create: `tests/extract/cloudflare-retry.test.ts`

- [ ] **Step 1: Create test file with 3 test cases**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";

describe("Cloudflare bot retry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries with honest User-Agent on 403 + cf-mitigated: challenge", async () => {
    const calls: Request[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, headers } as unknown as Request);

      if (calls.length === 1) {
        return new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      return new Response("<html><body>Hello</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const result = await extractContent("https://example.com");

    expect(calls).toHaveLength(2);
    // First call uses browser UA
    expect((calls[0] as any).headers?.["User-Agent"]).toContain("Mozilla/5.0");
    // Retry uses honest UA
    expect((calls[1] as any).headers?.["User-Agent"]).toContain("pi-tools");
    expect(result.text).toContain("Hello");
  });

  it("does NOT retry on 403 without cf-mitigated header", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Forbidden", {
        status: 403,
        headers: {},
      });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates error if retry also fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      return new Response("Still blocked", {
        status: 403,
        headers: {},
      });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(callCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/extract/cloudflare-retry.test.ts
```

Expected: FAIL — retry does not fire yet, so the first test fails (only 1 call, not 2), and the text assertion fails.

---

### Task 2: Implement Cloudflare bot retry

**Files:**
- Modify: `src/extract/pipeline.ts:165-185`

- [ ] **Step 3: Add honest User-Agent constant**

In `src/extract/pipeline.ts`, after the `BROWSER_HEADERS` constant (around line 64), add:

```typescript
const HONEST_USER_AGENT = "pi-tools/0.3.0 (content extraction)";
```

- [ ] **Step 4: Add retry logic after fetch, before status check**

Replace the block at lines 165-185 of `src/extract/pipeline.ts`:

```typescript
  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal,
      redirect: "follow",
    });
  } catch (err) {
    throw new RetryableExtractionError(err instanceof Error ? err.message : String(err));
  }

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    const status = response.status;
    // 429 and 5xx are retryable — a different provider might succeed
    if (status === 429 || status >= 500) {
      throw new RetryableExtractionError(`HTTP ${status}: ${response.statusText}`);
    }
    throw new Error(`HTTP ${status}: ${response.statusText}`);
  }
```

with:

```typescript
  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal,
      redirect: "follow",
    });
  } catch (err) {
    throw new RetryableExtractionError(err instanceof Error ? err.message : String(err));
  }

  // Cloudflare bot challenge: retry once with honest User-Agent
  if (
    response.status === 403 &&
    response.headers.get("cf-mitigated") === "challenge"
  ) {
    chain.push("cf-challenge");
    try {
      response = await fetch(url, {
        headers: { ...BROWSER_HEADERS, "User-Agent": HONEST_USER_AGENT },
        signal,
        redirect: "follow",
      });
    } catch (err) {
      throw new RetryableExtractionError(err instanceof Error ? err.message : String(err));
    }
  }

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    const status = response.status;
    // 429 and 5xx are retryable — a different provider might succeed
    if (status === 429 || status >= 500) {
      throw new RetryableExtractionError(`HTTP ${status}: ${response.statusText}`);
    }
    throw new Error(`HTTP ${status}: ${response.statusText}`);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run tests/extract/cloudflare-retry.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Run all tests to verify no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

---

### Task 3: Commit

- [ ] **Step 7: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/cloudflare-retry.test.ts
git commit -m "feat: retry with honest User-Agent on Cloudflare bot challenge

When a fetch returns 403 with cf-mitigated: challenge, retry once
with an honest User-Agent (pi-tools/0.3.0) instead of the browser
User-Agent. If the retry also fails, fall through to normal error
handling.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 1 complete.** Phase 1b (Cloudflare AI Gateway) was already implemented in `src/extract/gemini-api.ts` with tests in `tests/extract/gemini-api.test.ts`. No additional work needed.
