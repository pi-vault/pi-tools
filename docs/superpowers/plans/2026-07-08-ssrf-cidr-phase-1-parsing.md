# Phase 1: CIDR Parsing + Matching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CIDR parsing and IP-range-matching utility functions to `src/utils/ssrf.ts` with comprehensive tests.

**Architecture:** Pure functions — no side effects, no behavior change to existing `validateUrl`. Functions are added and exported but not yet wired into validation logic. Phase 2 wires them.

**Tech Stack:** TypeScript, Vitest, Node.js `net` module

---

## Context for the Engineer

**What is this project?** `pi-tools` is a Pi coding agent extension providing web search/fetch tools. It has an SSRF guard (`src/utils/ssrf.ts`) that blocks requests to private IPs. We're adding CIDR-based exemptions so users with TUN/fake-IP proxies can unblock synthetic IP ranges.

**What does this phase do?** Adds low-level CIDR parsing (e.g., parse `"198.18.0.0/15"` into bytes + prefix length) and matching (does IP X fall within CIDR Y?). Pure utility code with no integration.

**Key reference:** The functions are ported from `/Users/lanh/Developer/pi-packages/nicobailon-pi-web-access/ssrf-protection.ts` lines 152-280.

**Run tests:** `npx vitest run tests/utils/ssrf-cidr.test.ts`

**Run all tests:** `npx vitest run`

---

### Task 1: Add ParsedCidr type and IPv6 parser

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Add ParsedCidr interface and parseIPv6 function at the end of `src/utils/ssrf.ts`**

Add after the closing brace of `validateUrl` (after line 105):

```typescript
// --- CIDR Parsing & Matching ---

/** Parsed CIDR: a network address (4 or 16 bytes) + prefix length. */
export interface ParsedCidr {
  bytes: Uint8Array;
  prefix: number;
}

/**
 * Parse an IPv6 address string into 8 16-bit groups.
 * Handles `::` expansion and IPv4-mapped suffixes (e.g., `::ffff:192.168.1.1`).
 * Returns null if the address is malformed.
 */
export function parseIPv6(address: string): number[] | null {
  // Handle IPv4-mapped suffix (e.g., ::ffff:1.2.3.4)
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4Part = address.slice(lastColon + 1);
    if (net.isIP(ipv4Part) !== 4) return null;
    const octets = ipv4Part.split(".").map((p) => Number(p));
    address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const pieces = address.split("::");
  if (pieces.length > 2) return null;

  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (pieces.length === 1 && missing !== 0) return null;
  if (pieces.length === 2 && missing < 0) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right].map(
    (part) => {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return -1;
      return parseInt(part, 16);
    },
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
}
```

Also add this import at the top of the file (line 1, before the SSRFError class):

```typescript
import net from "node:net";
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only pre-existing ones unrelated to ssrf.ts)

- [ ] **Step 3: Commit**

```bash
git add src/utils/ssrf.ts
git commit -m "feat(ssrf): add ParsedCidr type and parseIPv6 function"
```

---

### Task 2: Add byte-conversion helpers

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Add ipv4ToBytes, ipv6GroupsToBytes, ipToBytes after parseIPv6**

Append after the `parseIPv6` function:

```typescript
export function ipv4ToBytes(address: string): Uint8Array | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const octet = Number(parts[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    bytes[i] = octet;
  }
  return bytes;
}

export function ipv6GroupsToBytes(groups: number[]): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = groups[i] >> 8;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

export function ipToBytes(address: string, version: number): Uint8Array | null {
  if (version === 4) return ipv4ToBytes(address);
  if (version === 6) {
    const groups = parseIPv6(address);
    return groups ? ipv6GroupsToBytes(groups) : null;
  }
  return null;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/ssrf.ts
git commit -m "feat(ssrf): add byte-conversion helpers for IPv4/IPv6"
```

---

### Task 3: Add parseCidr function

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Add parseCidr after ipToBytes**

Append after `ipToBytes`:

```typescript
/**
 * Parse a single CIDR (e.g., "198.18.0.0/15", "fd00::/8") or bare IP ("1.2.3.4").
 * Bare IPs are treated as /32 (IPv4) or /128 (IPv6).
 * Returns null if invalid. Rejects /0 prefixes (would exempt all addresses).
 */
export function parseCidr(raw: string): ParsedCidr | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const slash = trimmed.lastIndexOf("/");
  const addrPart = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const prefixPart = slash >= 0 ? trimmed.slice(slash + 1) : null;

  // A slash must be followed by digits only. Reject "" and whitespace to
  // prevent Number("") === 0 silently turning "198.18.0.0/" into /0.
  if (prefixPart !== null && !/^\d+$/.test(prefixPart)) return null;

  const version = net.isIP(addrPart);

  if (version === 4) {
    const bytes = ipv4ToBytes(addrPart);
    if (!bytes) return null;
    const prefix = prefixPart === null ? 32 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return null;
    return { bytes, prefix };
  }
  if (version === 6) {
    const groups = parseIPv6(addrPart);
    if (!groups) return null;
    const prefix = prefixPart === null ? 128 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) return null;
    return { bytes: ipv6GroupsToBytes(groups), prefix };
  }
  return null;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/ssrf.ts
git commit -m "feat(ssrf): add parseCidr function"
```

---

### Task 4: Add parseAllowRanges validation function

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Add parseAllowRanges after parseCidr**

Append after `parseCidr`:

```typescript
/**
 * Parse and validate an `allowRanges` config value.
 * Returns validated CIDR rules. Throws on malformed entries (fail-loud).
 */
export function parseAllowRanges(input: unknown): ParsedCidr[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("ssrf.allowRanges must be an array of CIDR strings");
  }
  const rules: ParsedCidr[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") {
      throw new Error(
        `ssrf.allowRanges entries must be strings, got ${typeof entry}`,
      );
    }
    const rule = parseCidr(entry.trim());
    if (!rule) {
      throw new Error(`Invalid CIDR notation in ssrf.allowRanges: "${entry}"`);
    }
    rules.push(rule);
  }
  return rules;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/ssrf.ts
git commit -m "feat(ssrf): add parseAllowRanges validation function"
```

---

### Task 5: Add bytesMatchPrefix and isInAllowedRange

**Files:**

- Modify: `src/utils/ssrf.ts`

- [ ] **Step 1: Add bytesMatchPrefix and isInAllowedRange after parseAllowRanges**

Append after `parseAllowRanges`:

```typescript
/** Compare the leading `prefix` bits of two equal-length byte arrays. */
export function bytesMatchPrefix(
  addr: Uint8Array,
  network: Uint8Array,
  prefix: number,
): boolean {
  const fullBytes = prefix >> 3;
  const remBits = prefix & 7;
  for (let i = 0; i < fullBytes; i++) {
    if (addr[i] !== network[i]) return false;
  }
  if (remBits > 0 && fullBytes < addr.length) {
    const mask = (0xff << (8 - remBits)) & 0xff;
    if ((addr[fullBytes] & mask) !== (network[fullBytes] & mask)) return false;
  }
  return true;
}

/** True if `address` (already validated as `ipVersion`) falls within any allowed CIDR. */
export function isInAllowedRange(
  address: string,
  ipVersion: number,
  allowRanges: ParsedCidr[],
): boolean {
  if (allowRanges.length === 0) return false;
  const addrBytes = ipToBytes(address, ipVersion);
  if (!addrBytes) return false;
  for (const rule of allowRanges) {
    // Only compare same-family rules (4-byte IPv4 vs 16-byte IPv6).
    if (rule.bytes.length !== addrBytes.length) continue;
    if (bytesMatchPrefix(addrBytes, rule.bytes, rule.prefix)) return true;
  }
  return false;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/ssrf.ts
git commit -m "feat(ssrf): add bytesMatchPrefix and isInAllowedRange"
```

---

### Task 6: Write tests for parseIPv6

**Files:**

- Create: `tests/utils/ssrf-cidr.test.ts`

- [ ] **Step 1: Create the test file with parseIPv6 tests**

```typescript
import { describe, expect, it } from "vitest";
import { parseIPv6 } from "../../src/utils/ssrf.ts";

describe("parseIPv6", () => {
  it("parses a full address", () => {
    const groups = parseIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    expect(groups).toEqual([
      0x2001, 0x0db8, 0x85a3, 0, 0, 0x8a2e, 0x0370, 0x7334,
    ]);
  });

  it("expands :: at the start", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("expands :: in the middle", () => {
    expect(parseIPv6("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("expands :: at the end", () => {
    expect(parseIPv6("fe80::")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("handles all-zeros", () => {
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("handles IPv4-mapped suffix", () => {
    const groups = parseIPv6("::ffff:192.168.1.1");
    expect(groups).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101]);
  });

  it("returns null for invalid input", () => {
    expect(parseIPv6("not-an-ip")).toBeNull();
    expect(parseIPv6("")).toBeNull();
    expect(parseIPv6(":::1")).toBeNull(); // triple colon
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull(); // too many groups
  });

  it("returns null for invalid hex groups", () => {
    expect(parseIPv6("gggg::1")).toBeNull();
    expect(parseIPv6("12345::1")).toBeNull(); // 5 hex digits
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/utils/ssrf-cidr.test.ts
git commit -m "test(ssrf): add parseIPv6 tests"
```

---

### Task 7: Write tests for byte-conversion helpers

**Files:**

- Modify: `tests/utils/ssrf-cidr.test.ts`

- [ ] **Step 1: Add ipv4ToBytes and ipv6GroupsToBytes tests**

Add after the `parseIPv6` describe block:

```typescript
import {
  ipv4ToBytes,
  ipv6GroupsToBytes,
  ipToBytes,
} from "../../src/utils/ssrf.ts";

describe("ipv4ToBytes", () => {
  it("converts a valid IPv4 address to 4 bytes", () => {
    expect(ipv4ToBytes("192.168.1.1")).toEqual(
      new Uint8Array([192, 168, 1, 1]),
    );
  });

  it("converts 0.0.0.0", () => {
    expect(ipv4ToBytes("0.0.0.0")).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it("converts 255.255.255.255", () => {
    expect(ipv4ToBytes("255.255.255.255")).toEqual(
      new Uint8Array([255, 255, 255, 255]),
    );
  });

  it("returns null for invalid addresses", () => {
    expect(ipv4ToBytes("256.0.0.0")).toBeNull();
    expect(ipv4ToBytes("1.2.3")).toBeNull();
    expect(ipv4ToBytes("1.2.3.4.5")).toBeNull();
    expect(ipv4ToBytes("abc.def.ghi.jkl")).toBeNull();
  });
});

describe("ipv6GroupsToBytes", () => {
  it("converts 8 groups to 16 bytes", () => {
    const bytes = ipv6GroupsToBytes([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(bytes).toEqual(
      new Uint8Array([0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
    );
  });
});

describe("ipToBytes", () => {
  it("dispatches IPv4", () => {
    expect(ipToBytes("10.0.0.1", 4)).toEqual(new Uint8Array([10, 0, 0, 1]));
  });

  it("dispatches IPv6", () => {
    const bytes = ipToBytes("::1", 6);
    expect(bytes).toEqual(
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
    );
  });

  it("returns null for unknown version", () => {
    expect(ipToBytes("10.0.0.1", 0)).toBeNull();
  });
});
```

Note: Move the `parseIPv6` import to a combined import statement at the top:

```typescript
import {
  parseIPv6,
  ipv4ToBytes,
  ipv6GroupsToBytes,
  ipToBytes,
} from "../../src/utils/ssrf.ts";
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/utils/ssrf-cidr.test.ts
git commit -m "test(ssrf): add byte-conversion helper tests"
```

---

### Task 8: Write tests for parseCidr

**Files:**

- Modify: `tests/utils/ssrf-cidr.test.ts`

- [ ] **Step 1: Add parseCidr tests**

Add the import `parseCidr` to the combined import line, then add this describe block:

```typescript
describe("parseCidr", () => {
  it("parses an IPv4 CIDR", () => {
    const result = parseCidr("198.18.0.0/15");
    expect(result).toEqual({
      bytes: new Uint8Array([198, 18, 0, 0]),
      prefix: 15,
    });
  });

  it("parses an IPv4 /32 (single host)", () => {
    const result = parseCidr("10.0.0.1/32");
    expect(result).toEqual({
      bytes: new Uint8Array([10, 0, 0, 1]),
      prefix: 32,
    });
  });

  it("treats bare IPv4 as /32", () => {
    const result = parseCidr("192.168.1.1");
    expect(result).toEqual({
      bytes: new Uint8Array([192, 168, 1, 1]),
      prefix: 32,
    });
  });

  it("parses an IPv6 CIDR", () => {
    const result = parseCidr("fd00::/8");
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(8);
    expect(result!.bytes.length).toBe(16);
    expect(result!.bytes[0]).toBe(0xfd);
  });

  it("parses an IPv6 /128 (single host)", () => {
    const result = parseCidr("::1/128");
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(128);
  });

  it("treats bare IPv6 as /128", () => {
    const result = parseCidr("fe80::1");
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(128);
  });

  it("rejects /0 prefix (would exempt everything)", () => {
    expect(parseCidr("0.0.0.0/0")).toBeNull();
    expect(parseCidr("::/0")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseCidr("")).toBeNull();
  });

  it("rejects non-IP addresses", () => {
    expect(parseCidr("not-an-ip/8")).toBeNull();
    expect(parseCidr("example.com/24")).toBeNull();
  });

  it("rejects missing prefix digits after slash", () => {
    expect(parseCidr("10.0.0.0/")).toBeNull();
    expect(parseCidr("10.0.0.0/ ")).toBeNull();
  });

  it("rejects prefix out of range", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("::1/129")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = parseCidr("  198.18.0.0/15  ");
    expect(result).toEqual({
      bytes: new Uint8Array([198, 18, 0, 0]),
      prefix: 15,
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/utils/ssrf-cidr.test.ts
git commit -m "test(ssrf): add parseCidr tests"
```

---

### Task 9: Write tests for parseAllowRanges

**Files:**

- Modify: `tests/utils/ssrf-cidr.test.ts`

- [ ] **Step 1: Add parseAllowRanges tests**

Add `parseAllowRanges` to the import, then add:

```typescript
describe("parseAllowRanges", () => {
  it("returns empty array for undefined", () => {
    expect(parseAllowRanges(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(parseAllowRanges(null)).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(parseAllowRanges([])).toEqual([]);
  });

  it("parses valid CIDR entries", () => {
    const result = parseAllowRanges(["198.18.0.0/15", "fd00::/8"]);
    expect(result).toHaveLength(2);
    expect(result[0].prefix).toBe(15);
    expect(result[1].prefix).toBe(8);
  });

  it("throws for non-array input", () => {
    expect(() => parseAllowRanges("198.18.0.0/15")).toThrow("must be an array");
    expect(() => parseAllowRanges(42)).toThrow("must be an array");
    expect(() => parseAllowRanges({})).toThrow("must be an array");
  });

  it("throws for non-string entry", () => {
    expect(() => parseAllowRanges([123])).toThrow("must be strings");
    expect(() => parseAllowRanges([null])).toThrow("must be strings");
  });

  it("throws for malformed CIDR entry", () => {
    expect(() => parseAllowRanges(["not-a-cidr"])).toThrow(
      "Invalid CIDR notation",
    );
    expect(() => parseAllowRanges(["10.0.0.0/0"])).toThrow(
      "Invalid CIDR notation",
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/utils/ssrf-cidr.test.ts
git commit -m "test(ssrf): add parseAllowRanges tests"
```

---

### Task 10: Write tests for bytesMatchPrefix and isInAllowedRange

**Files:**

- Modify: `tests/utils/ssrf-cidr.test.ts`

- [ ] **Step 1: Add matching tests**

Add `bytesMatchPrefix, isInAllowedRange` to the import, then add:

```typescript
describe("bytesMatchPrefix", () => {
  it("matches when prefix bits are identical", () => {
    const addr = new Uint8Array([198, 18, 1, 5]);
    const network = new Uint8Array([198, 18, 0, 0]);
    expect(bytesMatchPrefix(addr, network, 15)).toBe(true);
  });

  it("does not match when prefix bits differ", () => {
    const addr = new Uint8Array([198, 20, 0, 1]); // 198.20.x.x is outside 198.18/15
    const network = new Uint8Array([198, 18, 0, 0]);
    expect(bytesMatchPrefix(addr, network, 15)).toBe(false);
  });

  it("handles exact /32 match", () => {
    const addr = new Uint8Array([10, 0, 0, 1]);
    const network = new Uint8Array([10, 0, 0, 1]);
    expect(bytesMatchPrefix(addr, network, 32)).toBe(true);
  });

  it("rejects one-off on /32", () => {
    const addr = new Uint8Array([10, 0, 0, 2]);
    const network = new Uint8Array([10, 0, 0, 1]);
    expect(bytesMatchPrefix(addr, network, 32)).toBe(false);
  });

  it("handles partial-byte prefix (/10)", () => {
    // 172.16.0.0/12 means first 12 bits must match: 10101100.0001xxxx
    const addr = new Uint8Array([172, 31, 255, 255]); // inside
    const network = new Uint8Array([172, 16, 0, 0]);
    expect(bytesMatchPrefix(addr, network, 12)).toBe(true);

    const outside = new Uint8Array([172, 32, 0, 0]); // outside (bit 13 differs)
    expect(bytesMatchPrefix(outside, network, 12)).toBe(false);
  });
});

describe("isInAllowedRange", () => {
  it("returns false for empty allowRanges", () => {
    expect(isInAllowedRange("198.18.1.1", 4, [])).toBe(false);
  });

  it("returns true when IP is inside an allowed CIDR", () => {
    const ranges = parseAllowRanges(["198.18.0.0/15"]);
    expect(isInAllowedRange("198.18.1.1", 4, ranges)).toBe(true);
    expect(isInAllowedRange("198.19.255.255", 4, ranges)).toBe(true);
  });

  it("returns false when IP is outside allowed CIDR", () => {
    const ranges = parseAllowRanges(["198.18.0.0/15"]);
    expect(isInAllowedRange("198.20.0.1", 4, ranges)).toBe(false);
    expect(isInAllowedRange("10.0.0.1", 4, ranges)).toBe(false);
  });

  it("IPv4 rule does not match IPv6 address", () => {
    const ranges = parseAllowRanges(["10.0.0.0/8"]);
    expect(isInAllowedRange("::1", 6, ranges)).toBe(false);
  });

  it("IPv6 rule does not match IPv4 address", () => {
    const ranges = parseAllowRanges(["fd00::/8"]);
    expect(isInAllowedRange("10.0.0.1", 4, ranges)).toBe(false);
  });

  it("matches IPv6 CIDR", () => {
    const ranges = parseAllowRanges(["fd00::/8"]);
    expect(isInAllowedRange("fd12:3456::1", 6, ranges)).toBe(true);
    expect(isInAllowedRange("fe80::1", 6, ranges)).toBe(false);
  });

  it("first IP in range matches", () => {
    const ranges = parseAllowRanges(["198.18.0.0/15"]);
    expect(isInAllowedRange("198.18.0.0", 4, ranges)).toBe(true);
  });

  it("last IP in range matches", () => {
    const ranges = parseAllowRanges(["198.18.0.0/15"]);
    expect(isInAllowedRange("198.19.255.255", 4, ranges)).toBe(true);
  });

  it("one IP past the range does not match", () => {
    const ranges = parseAllowRanges(["198.18.0.0/15"]);
    expect(isInAllowedRange("198.20.0.0", 4, ranges)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/utils/ssrf-cidr.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/utils/ssrf-cidr.test.ts
git commit -m "test(ssrf): add bytesMatchPrefix and isInAllowedRange tests"
```

---

### Task 11: Run full test suite to confirm no regressions

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS. No existing tests broken by the additions.

- [ ] **Step 2: If any tests fail, investigate and fix before proceeding**

The new code is purely additive (no existing functions modified), so failures would indicate import issues or TypeScript errors. Fix as needed.
