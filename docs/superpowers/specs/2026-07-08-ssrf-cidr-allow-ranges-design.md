# SSRF CIDR Allow-Ranges Design

## Problem

pi-tools' SSRF guard blocks all private/reserved IPs, but users running TUN/fake-IP proxies (Surge, Clash, Mihomo) see legitimate public-domain requests fail because their proxy resolves domains into reserved ranges like `198.18.0.0/15`. Additionally, pi-tools blocks fewer reserved ranges than pi-web-access, leaving gaps for CGN and multicast addresses.

## Solution

Port pi-web-access's CIDR allow-ranges mechanism into pi-tools and align blocked IP ranges with pi-web-access, while keeping the synchronous, no-DNS-resolution design.

## Approach

**Approach C: CIDR + extra blocked ranges.** Adds CIDR allow-ranges AND aligns blocked IP ranges with pi-web-access. Stays synchronous (no DNS resolution, no redirect handling). The CIDR allow-ranges mechanism provides an escape hatch for users whose environments rely on newly-blocked ranges.

## Changes

### 1. SSRF Module (`src/utils/ssrf.ts`)

#### New Blocked IPv4 Ranges

Added to the existing `isPrivateIP` function (renamed to use explicit range checks):

| Range           | RFC      | Purpose                                    |
| --------------- | -------- | ------------------------------------------ |
| `0.0.0.0/8`     | RFC 1122 | Current network                            |
| `100.64.0.0/10` | RFC 6598 | Carrier-grade NAT                          |
| `198.18.0.0/15` | RFC 2544 | Benchmarking (hijacked by fake-IP proxies) |
| `224.0.0.0/4+`  | RFC 5771 | Multicast and reserved (224+)              |

Existing blocked ranges remain: `10/8`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`.

#### New Blocked IPv6 Ranges

Replace the bare `::1` check with full IPv6 parsing:

| Range            | Purpose                               |
| ---------------- | ------------------------------------- |
| `::/128`         | Unspecified address                   |
| `::1/128`        | Loopback                              |
| `fc00::/7`       | Unique Local Address (ULA)            |
| `fe80::/10`      | Link-local                            |
| `::ffff:x.x.x.x` | IPv4-mapped; delegated to IPv4 checks |

#### New Functions

Ported from pi-web-access's `ssrf-protection.ts`:

- `parseAllowRanges(input: unknown): ParsedCidr[]` — validates config array, throws on malformed entries
- `parseCidr(raw: string): ParsedCidr | null` — parses CIDR notation (e.g., `"198.18.0.0/15"`, `"fd00::/8"`) into `{ bytes: Uint8Array, prefix: number }`
- `isInAllowedRange(address: string, ipVersion: number, allowRanges: ParsedCidr[]): boolean` — checks if address falls within any allowed CIDR
- `bytesMatchPrefix(addr: Uint8Array, network: Uint8Array, prefix: number): boolean` — bitwise prefix comparison
- `ipv4ToBytes(address: string): Uint8Array | null` — converts IPv4 string to 4-byte array
- `ipv6GroupsToBytes(groups: number[]): Uint8Array` — converts 8 IPv6 groups to 16-byte array
- `ipToBytes(address: string, version: number): Uint8Array | null` — dispatch to IPv4/IPv6 conversion
- `parseIPv6(address: string): number[] | null` — full IPv6 group expansion with `::` handling

#### `ParsedCidr` Interface

```typescript
interface ParsedCidr {
  bytes: Uint8Array;
  prefix: number;
}
```

#### API Change

```typescript
export interface ValidateUrlOptions {
  allowedBaseUrls?: string[]; // existing: exact scheme+host+port bypass
  allowRanges?: string[]; // new: CIDR exemptions for private/reserved IPs
}
```

`validateUrl` remains synchronous. When `allowRanges` is provided, IPs matching an allowed CIDR bypass the private/reserved check. Protocol and credential checks are never bypassed.

#### Validation Behavior

- `/0` prefix rejected (would exempt all addresses)
- Non-string entries throw
- Malformed CIDR notation throws (fail-loud, not fail-silent)
- Bare IPs without `/prefix` treated as `/32` (IPv4) or `/128` (IPv6)

### 2. Config Integration

#### New Type (`src/config.ts`)

```typescript
export interface SsrfConfig {
  allowRanges: string[];
}
```

#### Added to `PiToolsConfig`

```typescript
export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig; // new
}
```

#### Default

```typescript
ssrf: {
  allowRanges: [];
}
```

#### User Config Example

```json
{
  "ssrf": {
    "allowRanges": ["198.18.0.0/15", "198.19.0.0/16"]
  }
}
```

#### Threading to Callers

- `src/extract/pipeline.ts` — add `allowRanges?: string[]` to `ExtractOptions`. The tool closure in `src/tools/web-fetch.ts` already has access to config via `ConfigManager`; pass `config.ssrf.allowRanges` into `extractContent(url, signal, { allowRanges })`. Inside `extractContent`, forward to `validateUrl(url, { allowRanges })`.
- `src/providers/searxng.ts` — add `allowRanges?: string[]` to `SearXNGOptions`. The `providerMeta.create()` factory closes over the full config at registration time; pass `config.ssrf.allowRanges` into `new SearXNGProvider({ instanceUrl, apiKey, allowRanges })`. At call time: `validateUrl(url, { allowedBaseUrls: [this.instanceUrl], allowRanges: this.allowRanges })`.

Config participates in existing three-layer merge (project > global > defaults) and auto-reload via `ConfigManager`. Arrays from higher-priority layers replace lower-priority arrays.

### 3. Testing

#### New test file: `tests/utils/ssrf-cidr.test.ts`

Keeps existing `ssrf.test.ts` untouched for clean separation.

**Test groups:**

1. **CIDR parsing (`parseCidr`)**
   - Valid IPv4 CIDRs: `"10.0.0.0/8"`, `"198.18.0.0/15"`
   - Valid IPv6 CIDRs: `"fd00::/8"`, `"fe80::/10"`
   - Bare IPs default to /32 or /128
   - Rejects: `/0`, empty string, non-IP, missing prefix digits (`"10.0.0.0/"`)

2. **Allow-ranges validation (`parseAllowRanges`)**
   - Empty array returns empty
   - `null`/`undefined` returns empty
   - Non-array throws
   - Non-string entry throws
   - Malformed CIDR entry throws

3. **Range matching (`isInAllowedRange` / `bytesMatchPrefix`)**
   - IP inside allowed CIDR returns true
   - IP outside allowed CIDR returns false
   - IPv4 rule doesn't match IPv6 address and vice versa
   - Edge cases: first IP in range, last IP in range, one-off outside

4. **Extended blocked ranges (additions to existing `ssrf.test.ts`)**
   - `0.0.0.0` blocked
   - `100.64.0.1` (CGN) blocked
   - `198.18.1.1` blocked
   - `224.0.0.1` (multicast) blocked
   - `255.255.255.255` blocked
   - IPv6: `::` blocked, `fc00::1` blocked, `fe80::1` blocked
   - IPv4-mapped IPv6: `::ffff:127.0.0.1` blocked

5. **Integration: `validateUrl` with `allowRanges`**
   - Blocked IP passes when in allowRanges
   - Blocked IP still fails when NOT in allowRanges
   - `allowRanges` does NOT bypass protocol or credential checks
   - Works alongside `allowedBaseUrls` (both mechanisms independent)

## Non-Goals

- DNS resolution of hostnames before IP validation
- Redirect-following with re-validation at each hop
- Geographic IP filtering
- Runtime config validation UI (errors surface at tool invocation time)

## Risks

- **Potentially breaking for users fetching from `198.18.x.x` or `100.64.x.x`**: mitigated by `allowRanges` escape hatch
- **Still vulnerable to DNS rebinding**: accepted tradeoff for staying synchronous; pi-tools currently only checks literal IPs in URLs, not resolved addresses
