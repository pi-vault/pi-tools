import net from "node:net";

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".localhost")) return true;
  return false;
}

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

export interface ValidateUrlOptions {
  /** Explicit base URLs (scheme + host + port) that bypass hostname/IP blocks. */
  allowedBaseUrls?: string[];
}

function matchesAllowedBase(parsed: URL, allowedBaseUrls: string[]): boolean {
  for (const base of allowedBaseUrls) {
    try {
      const b = new URL(base);
      if (
        b.protocol === parsed.protocol &&
        b.hostname === parsed.hostname &&
        b.port === parsed.port
      ) {
        return true;
      }
    } catch {
      // ignore malformed allowed base URL
    }
  }
  return false;
}

export function validateUrl(url: string, opts?: ValidateUrlOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(`Invalid URL: ${url}`);
  }

  // Protocol check (allowedBaseUrls cannot bypass this)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
  }

  // Credentials check (allowedBaseUrls cannot bypass this)
  if (parsed.username || parsed.password) {
    throw new SSRFError("URLs with credentials are not allowed");
  }

  // Hostname checks (guaranteed non-empty for http/https, but guard explicitly)
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SSRFError("URL has no hostname");
  }

  const allowed =
    opts?.allowedBaseUrls?.length &&
    matchesAllowedBase(parsed, opts.allowedBaseUrls);

  if (!allowed) {
    if (isBlockedHostname(hostname)) {
      throw new SSRFError(`Blocked hostname: ${hostname}`);
    }

    const cleanedIp = hostname.replace(/^\[|\]$/g, "");
    const ipVersion = net.isIP(cleanedIp);
    if (ipVersion === 6) {
      if (isBlockedIPv6(cleanedIp)) {
        throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
      }
    } else if (ipVersion === 4 && isBlockedIPv4(cleanedIp)) {
      throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
    }
  }

  return parsed;
}

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
  if (version === 0) return null;
  const maxPrefix = version === 4 ? 32 : 128;
  const bytes = ipToBytes(addrPart, version);
  if (!bytes) return null;
  const prefix = prefixPart === null ? maxPrefix : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > maxPrefix) return null;
  return { bytes, prefix };
}

/**
 * Parse and validate an `allowRanges` config value.
 * Returns validated CIDR rules. Throws on malformed entries (fail-loud).
 */
export function parseAllowRanges(input: unknown): ParsedCidr[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error("ssrf.allowRanges must be an array of CIDR strings");
  }
  return input.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(
        `ssrf.allowRanges entries must be strings, got ${typeof entry}`,
      );
    }
    const rule = parseCidr(entry.trim());
    if (!rule) {
      throw new Error(`Invalid CIDR notation in ssrf.allowRanges: "${entry}"`);
    }
    return rule;
  });
}

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
