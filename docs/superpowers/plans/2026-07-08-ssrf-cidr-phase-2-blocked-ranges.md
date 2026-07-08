# Phase 2: Extended Blocked Ranges + allowRanges in validateUrl

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand SSRF blocked IP ranges and wire `allowRanges` into `validateUrl` so CIDR exemptions actually work.

**Architecture:** Replace `isPrivateIP` with `isBlockedIPv4` + `isBlockedIPv6` (fuller checks). Add `allowRanges` to `ValidateUrlOptions`. IPs matching allowed CIDRs bypass blocked-range checks (but not protocol/credential checks).

**Tech Stack:** TypeScript, Vitest, Node.js `net` module

**Prerequisite:** Phase 1 must be complete (CIDR parsing functions exist in `src/utils/ssrf.ts`).

---

## Context for the Engineer

**What changed in Phase 1:** `src/utils/ssrf.ts` now has these exported functions at the bottom: `parseIPv6`, `ipv4ToBytes`, `ipv6GroupsToBytes`, `ipToBytes`, `parseCidr`, `parseAllowRanges`, `bytesMatchPrefix`, `isInAllowedRange`. Plus the `ParsedCidr` type.

**What this phase does:** Modifies the existing `validateUrl` function to use the new CIDR functions. Replaces the simplistic `isPrivateIP` with comprehensive IPv4/IPv6 blocked-range checks. Adds `allowRanges?: string[]` to `ValidateUrlOptions`.

**Run tests:** `npx vitest run tests/utils/`

---

### Task 1: Replace isPrivateIP with isBlockedIPv4

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Write failing test for newly-blocked ranges**

Add to `tests/utils/ssrf.test.ts`, inside the existing `describe("validateUrl", ...)` block, after the "blocks link-local addresses" test:

```typescript
it("blocks current-network addresses (0.0.0.0/8)", () => {
  expect(() => validateUrl("http://0.0.0.1")).toThrow(SSRFError);
  expect(() => validateUrl("http://0.255.255.255")).toThrow(SSRFError);
});

it("blocks carrier-grade NAT (100.64.0.0/10)", () => {
  expect(() => validateUrl("http://100.64.0.1")).toThrow(SSRFError);
  expect(() => validateUrl("http://100.127.255.255")).toThrow(SSRFError);
});

it("blocks benchmarking range (198.18.0.0/15)", () => {
  expect(() => validateUrl("http://198.18.0.1")).toThrow(SSRFError);
  expect(() => validateUrl("http://198.19.255.255")).toThrow(SSRFError);
});

it("blocks multicast and reserved (224.0.0.0+)", () => {
  expect(() => validateUrl("http://224.0.0.1")).toThrow(SSRFError);
  expect(() => validateUrl("http://239.255.255.255")).toThrow(SSRFError);
  expect(() => validateUrl("http://255.255.255.255")).toThrow(SSRFError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: FAIL — the new ranges (0.x.x.x, 100.64.x.x, 198.18.x.x, 224+) are not yet blocked.

- [ ] **Step 3: Replace `isPrivateIP` with `isBlockedIPv4` in `src/utils/ssrf.ts`**

Replace the existing `isPrivateIP` function (lines 16-41) with:

```typescript
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  )
    return true;
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 — current network
    a === 10 || // 10.0.0.0/8 — private
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — CGN
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — private
    (a === 192 && b === 168) || // 192.168.0.0/16 — private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 — benchmarking
    a >= 224 // 224.0.0.0/4+ — multicast & reserved
  );
}
```

Then update the IP-checking block in `validateUrl`. Replace the existing lines:

```typescript
if (isPrivateIP(hostname)) {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
```

with:

```typescript
const cleanedIp = hostname.replace(/^\[|\]$/g, "");
if (cleanedIp === "::1") {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
if (net.isIP(cleanedIp) === 4 && isBlockedIPv4(cleanedIp)) {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
```

**Important:** `isBlockedIPv4` returns `true` for non-IPv4 strings, so we MUST guard with `net.isIP(cleanedIp) === 4`. The `cleanedIp === "::1"` preserves existing IPv6 loopback blocking until Task 2 adds full IPv6 support. The `net` import was added in Phase 1 Task 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: All tests PASS including the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "feat(ssrf): expand blocked IPv4 ranges (0/8, CGN, benchmarking, multicast)"
```

---

### Task 2: Add isBlockedIPv6 with full parsing

**Files:**

- Modify: `src/utils/ssrf.ts`
- Modify: `tests/utils/ssrf.test.ts`

- [ ] **Step 1: Write failing tests for IPv6 blocking**

Add to `tests/utils/ssrf.test.ts` inside `describe("validateUrl", ...)`:

```typescript
it("blocks IPv6 unspecified address", () => {
  expect(() => validateUrl("http://[::]")).toThrow(SSRFError);
});

it("blocks IPv6 ULA (fc00::/7)", () => {
  expect(() => validateUrl("http://[fc00::1]")).toThrow(SSRFError);
  expect(() => validateUrl("http://[fd12:3456::1]")).toThrow(SSRFError);
});

it("blocks IPv6 link-local (fe80::/10)", () => {
  expect(() => validateUrl("http://[fe80::1]")).toThrow(SSRFError);
});

it("blocks IPv4-mapped IPv6 with private IPv4", () => {
  expect(() => validateUrl("http://[::ffff:127.0.0.1]")).toThrow(SSRFError);
  expect(() => validateUrl("http://[::ffff:10.0.0.1]")).toThrow(SSRFError);
  expect(() => validateUrl("http://[::ffff:192.168.1.1]")).toThrow(SSRFError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: FAIL — only `::1` is currently blocked for IPv6.

- [ ] **Step 3: Add `isBlockedIPv6` function and wire it into `validateUrl`**

Add this function in `src/utils/ssrf.ts` after `isBlockedIPv4`:

```typescript
function isBlockedIPv6(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, "");
  const groups = parseIPv6(cleaned);
  if (!groups) return true; // Unparseable → block

  // Unspecified ::/128
  if (groups.every((g) => g === 0)) return true;
  // Loopback ::1/128
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  // ULA fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;

  // IPv4-mapped ::ffff:x.x.x.x — delegate to IPv4 check
  const isMapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMapped) {
    const ipv4 = [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join(".");
    return isBlockedIPv4(ipv4);
  }

  return false;
}
```

Now update `validateUrl` to use both checkers. Replace the current IP check block (from Task 1):

```typescript
const cleanedIp = hostname.replace(/^\[|\]$/g, "");
if (cleanedIp === "::1") {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
if (net.isIP(cleanedIp) === 4 && isBlockedIPv4(cleanedIp)) {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
```

with:

```typescript
const cleanedIp = hostname.replace(/^\[|\]$/g, "");
const ipVersion = net.isIP(cleanedIp);
if (ipVersion === 6) {
  if (isBlockedIPv6(cleanedIp)) {
    throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
  }
} else if (ipVersion === 4 && isBlockedIPv4(cleanedIp)) {
  throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
}
```

Note: For hostnames (ipVersion === 0), neither branch fires — hostnames are handled by `isBlockedHostname` above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "feat(ssrf): add full IPv6 blocking (ULA, link-local, mapped)"
```

---

### Task 3: Wire allowRanges into validateUrl

**Files:**

- Modify: `src/utils/ssrf.ts`
- Modify: `tests/utils/ssrf.test.ts`

- [ ] **Step 1: Write failing test for allowRanges bypassing blocked IPs**

Add a new describe block at the end of `tests/utils/ssrf.test.ts`:

```typescript
describe("validateUrl with allowRanges", () => {
  it("allows a blocked IP when it falls in an allowed CIDR", () => {
    const result = validateUrl("http://198.18.1.1/path", {
      allowRanges: ["198.18.0.0/15"],
    });
    expect(result.hostname).toBe("198.18.1.1");
  });

  it("still blocks IPs NOT in allowRanges", () => {
    expect(() =>
      validateUrl("http://10.0.0.1", {
        allowRanges: ["198.18.0.0/15"],
      }),
    ).toThrow(SSRFError);
  });

  it("allows IPv6 address when in allowed range", () => {
    const result = validateUrl("http://[fd00::1]:8080/path", {
      allowRanges: ["fd00::/8"],
    });
    expect(result.hostname).toBe("[fd00::1]");
  });

  it("does NOT bypass protocol check", () => {
    expect(() =>
      validateUrl("ftp://198.18.1.1", {
        allowRanges: ["198.18.0.0/15"],
      }),
    ).toThrow("Blocked protocol");
  });

  it("does NOT bypass credentials check", () => {
    expect(() =>
      validateUrl("http://user:pass@198.18.1.1", {
        allowRanges: ["198.18.0.0/15"],
      }),
    ).toThrow("credentials");
  });

  it("works alongside allowedBaseUrls (both independent)", () => {
    // allowedBaseUrls lets localhost through, allowRanges lets 198.18/15 through
    const result = validateUrl("http://198.18.1.1:9090/path", {
      allowedBaseUrls: ["http://localhost:8080"],
      allowRanges: ["198.18.0.0/15"],
    });
    expect(result.hostname).toBe("198.18.1.1");
  });

  it("throws on malformed allowRanges config", () => {
    expect(() =>
      validateUrl("http://example.com", {
        allowRanges: ["not-a-cidr"],
      }),
    ).toThrow("Invalid CIDR notation");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: FAIL — `allowRanges` is not yet in `ValidateUrlOptions`.

- [ ] **Step 3: Add `allowRanges` to `ValidateUrlOptions` and wire into `validateUrl`**

Update the interface in `src/utils/ssrf.ts`:

```typescript
export interface ValidateUrlOptions {
  /** Explicit base URLs (scheme + host + port) that bypass hostname/IP blocks. */
  allowedBaseUrls?: string[];
  /** CIDR ranges (e.g., "198.18.0.0/15") exempt from private/reserved IP checks. */
  allowRanges?: string[];
}
```

Then update the IP-checking logic in `validateUrl`. Replace the block that starts with `if (!allowed) {` (the hostname/IP checking section) with:

```typescript
if (!allowed) {
  if (isBlockedHostname(hostname)) {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  const cleanedIp = hostname.replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(cleanedIp);

  if (ipVersion > 0) {
    // Check allowRanges before blocking
    const allowedRanges = parseAllowRanges(opts?.allowRanges);
    if (!isInAllowedRange(cleanedIp, ipVersion, allowedRanges)) {
      if (ipVersion === 6) {
        if (isBlockedIPv6(cleanedIp)) {
          throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
        }
      } else if (isBlockedIPv4(cleanedIp)) {
        throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run all tests to confirm no regressions**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "feat(ssrf): wire allowRanges into validateUrl for CIDR exemptions"
```

---

### Task 4: Verify existing allowedBaseUrls tests still pass

- [ ] **Step 1: Run the full SSRF test file**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: All tests PASS — the `allowedBaseUrls` describe block should be unaffected since its mechanism is independent of `allowRanges`.

- [ ] **Step 2: Run the CIDR test file**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: All tests PASS.
