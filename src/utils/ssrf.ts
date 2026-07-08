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

function isPrivateIP(hostname: string): boolean {
  // Remove IPv6 brackets
  const ip = hostname.replace(/^\[|\]$/g, "");

  // IPv6 loopback
  if (ip === "::1") return true;

  // IPv4 checks
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;

  const [a, b] = parts;

  // Loopback: 127.0.0.0/8
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true;

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

    if (isPrivateIP(hostname)) {
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
