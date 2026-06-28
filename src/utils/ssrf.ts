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

export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(`Invalid URL: ${url}`);
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
  }

  // Credentials check
  if (parsed.username || parsed.password) {
    throw new SSRFError("URLs with credentials are not allowed");
  }

  // Hostname checks
  const hostname = parsed.hostname;

  if (isBlockedHostname(hostname)) {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  if (isPrivateIP(hostname)) {
    throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
  }

  return parsed;
}
