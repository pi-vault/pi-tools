# Content Extraction Phase 3: Chrome Cookie Extraction & Gemini Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/chrome-cookies.ts` and `src/extract/gemini-web.ts` -- cookie extraction from Chromium browsers and Gemini Web client using those cookies for authenticated access to Gemini without an API key.

**Architecture:** Two modules: (1) chrome-cookies reads encrypted cookie databases from local Chromium-based browsers and decrypts them using OS keychain credentials; (2) gemini-web uses those cookies to authenticate against Google's Gemini web interface (BardChatUi) for model inference. The cookie module handles macOS and Linux decryption paths. The Gemini Web client handles access token parsing, file uploads, model selection, and streaming response parsing.

**Tech Stack:** TypeScript, Vitest, `node:sqlite` (dynamic import with module-scoped cache), `node:crypto` (pbkdf2Sync, createDecipheriv), `node:child_process` (execFile with timeout), `node:fs` (readFileSync, copyFileSync, etc.), native `fetch`

**Parent Plan:** `2026-07-13-content-extraction.md`
**Prerequisite:** Phase 2 complete (gemini-api.ts exists)

**Reference implementation:** `nicobailon-pi-web-access` repo (`chrome-cookies.ts`, `gemini-web.ts`, `gemini-web-config.ts`). This plan ports that logic into pi-tools, adapting to pi-tools conventions (ESM, top-level imports only, `loadConfig()` from `src/config.ts`, Vitest + `stubFetch()` helpers).

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `src/extract/gemini-api.ts` | Gemini REST API client (Phase 2) -- follow its config-loading pattern |
| `src/config.ts` | `loadConfig()`, `resolveApiKey()`, `GeminiConfig` (already has `allowBrowserCookies`, `chromeProfile`) |
| `tests/helpers.ts` | `stubFetch()`, `stubExec()`, `createMockPi` test utilities |
| `nicobailon-pi-web-access/chrome-cookies.ts` | Reference cookie extraction (port from here) |
| `nicobailon-pi-web-access/gemini-web.ts` | Reference Gemini Web client (port from here) |

---

## Task 1: Create `src/extract/chrome-cookies.ts`

**Files:** `src/extract/chrome-cookies.ts`

Port from `nicobailon-pi-web-access/chrome-cookies.ts`, adapting to pi-tools style.

- [ ] **Step 1:** Create the file with type exports, browser configs, and cookie name allowlist

```typescript
// src/extract/chrome-cookies.ts
import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

export type CookieMap = Record<string, string>;

interface BrowserConfig {
  name: string;
  /** Path relative to home directory */
  baseDir: string;
  /** macOS keychain service name */
  keychainService?: string;
  /** macOS keychain account */
  keychainAccount?: string;
  /** Linux secret-tool application name */
  secretToolApp?: string;
}

const GOOGLE_ORIGINS = [
  "https://gemini.google.com",
  "https://accounts.google.com",
  "https://www.google.com",
];

/**
 * Allowlist of Google cookie names relevant to Gemini authentication.
 * Only these cookies are extracted and returned -- everything else is ignored.
 */
const ALL_COOKIE_NAMES = new Set([
  "__Secure-1PSID",
  "__Secure-1PSIDTS",
  "__Secure-1PSIDCC",
  "__Secure-1PAPISID",
  "NID",
  "AEC",
  "SOCS",
  "__Secure-BUCKET",
  "__Secure-ENID",
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-3PSID",
  "__Secure-3PSIDTS",
  "__Secure-3PAPISID",
  "SIDCC",
]);

const MACOS_BROWSER_CONFIGS: BrowserConfig[] = [
  {
    name: "Helium",
    baseDir: "Library/Application Support/net.imput.helium",
    keychainService: "Helium Storage Key",
    keychainAccount: "Helium",
  },
  {
    name: "Chrome",
    baseDir: "Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  },
  {
    name: "Arc",
    baseDir: "Library/Application Support/Arc/User Data",
    keychainService: "Arc Safe Storage",
    keychainAccount: "Arc",
  },
];

const LINUX_BROWSER_CONFIGS: BrowserConfig[] = [
  {
    name: "Chromium",
    baseDir: ".config/chromium",
    secretToolApp: "chromium",
  },
  {
    name: "Chrome",
    baseDir: ".config/google-chrome",
    secretToolApp: "chrome",
  },
];

const KEYCHAIN_TIMEOUT_MS = 5000;
```

- [ ] **Step 2:** Add the main `getGoogleCookies` function and browser iteration loop

```typescript
/**
 * Extract Google cookies from a local Chromium-based browser.
 * Tries each known browser in order and returns the first that has all
 * required cookies. Returns null if extraction fails for all browsers.
 */
export async function getGoogleCookies(options?: {
  profile?: string;
  requiredCookies?: string[];
}): Promise<{ cookies: CookieMap; warnings: string[] } | null> {
  const currentPlatform = platform();
  const configs =
    currentPlatform === "darwin"
      ? MACOS_BROWSER_CONFIGS
      : currentPlatform === "linux"
        ? LINUX_BROWSER_CONFIGS
        : [];
  if (configs.length === 0) return null;

  const warnings: string[] = [];
  const profile = options?.profile ?? "Default";
  const hosts = GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname);

  for (const config of configs) {
    const cookiesPath = join(homedir(), config.baseDir, profile, "Cookies");
    if (!existsSync(cookiesPath)) continue;

    const password = await readBrowserPassword(config, currentPlatform);
    if (!password) {
      warnings.push(`Could not read ${config.name} cookie encryption password`);
      continue;
    }

    const iterations = currentPlatform === "darwin" ? 1003 : 1;
    const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
    const tempDir = mkdtempSync(join(tmpdir(), "pi-chrome-cookies-"));

    try {
      const tempDb = join(tempDir, "Cookies");
      copyFileSync(cookiesPath, tempDb);
      copySidecar(cookiesPath, tempDb, "-wal");
      copySidecar(cookiesPath, tempDb, "-shm");

      const metaVersion = await readMetaVersion(tempDb);
      const stripHash = metaVersion >= 24;
      const rows = await queryCookieRows(tempDb, hosts);
      if (!rows) {
        warnings.push(`Failed to query ${config.name} cookie database`);
        continue;
      }

      const cookies: CookieMap = {};
      for (const row of rows) {
        const name = row.name as string;
        if (!ALL_COOKIE_NAMES.has(name)) continue;
        if (cookies[name]) continue; // keep first (freshest, sorted by expires_utc DESC)

        let value =
          typeof row.value === "string" && row.value.length > 0
            ? row.value
            : null;
        if (!value) {
          const encrypted = row.encrypted_value;
          if (encrypted instanceof Uint8Array) {
            value = decryptCookieValue(encrypted, key, stripHash);
          }
        }
        if (value) cookies[name] = value;
      }

      if (
        options?.requiredCookies?.length &&
        !options.requiredCookies.every((name) => Boolean(cookies[name]))
      ) {
        continue;
      }

      return { cookies, warnings };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return null;
}
```

- [ ] **Step 3:** Add decryption logic

```typescript
/**
 * Decrypt a Chromium cookie value.
 * - Strips vNN prefix (3 bytes)
 * - AES-128-CBC with IV of 16 x 0x20 bytes
 * - Removes PKCS7 padding
 * - If stripHash is true (Chrome DB v24+), removes first 32 bytes of plaintext
 */
function decryptCookieValue(
  encrypted: Uint8Array,
  key: Buffer,
  stripHash: boolean,
): string | null {
  const buf = Buffer.from(encrypted);
  if (buf.length < 3) return null;

  const prefix = buf.subarray(0, 3).toString("utf8");
  if (!/^v\d\d$/.test(prefix)) return null;

  const ciphertext = buf.subarray(3);
  if (!ciphertext.length) return "";

  try {
    const iv = Buffer.alloc(16, 0x20);
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const unpadded = removePkcs7Padding(plaintext);
    const bytes =
      stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Strip leading control characters (< 0x20)
    let i = 0;
    while (i < decoded.length && decoded.charCodeAt(i) < 0x20) i++;
    return decoded.slice(i);
  } catch {
    return null;
  }
}

function removePkcs7Padding(buf: Buffer): Buffer {
  if (!buf.length) return buf;
  const padding = buf[buf.length - 1];
  if (!padding || padding > 16) return buf;
  return buf.subarray(0, buf.length - padding);
}
```

- [ ] **Step 4:** Add keychain/password reading functions

```typescript
function readBrowserPassword(
  config: BrowserConfig,
  currentPlatform: string,
): Promise<string | null> {
  if (currentPlatform === "darwin") {
    if (!config.keychainAccount || !config.keychainService)
      return Promise.resolve(null);
    return readKeychainPassword(
      config.keychainAccount,
      config.keychainService,
    );
  }
  if (currentPlatform === "linux") {
    return readLinuxPassword(config.secretToolApp);
  }
  return Promise.resolve(null);
}

function readKeychainPassword(
  account: string,
  service: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-w", "-a", account, "-s", service],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(stdout.trim() || null);
      },
    );
  });
}

function readLinuxPassword(secretToolApp: string | undefined): Promise<string> {
  if (!secretToolApp) return Promise.resolve("peanuts");

  return new Promise((resolve) => {
    execFile(
      "secret-tool",
      ["lookup", "application", secretToolApp],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          // KDE Wallet users fall through to peanuts intentionally
          resolve("peanuts");
          return;
        }
        resolve(stdout.trim() || "peanuts");
      },
    );
  });
}
```

- [ ] **Step 5:** Add SQLite helpers (cached import, meta version, cookie query, host expansion)

```typescript
/**
 * Module-scoped cache for the node:sqlite import.
 * Avoids repeated dynamic imports and experimental-warning suppression.
 */
let sqliteModule: typeof import("node:sqlite") | null = null;

async function importSqlite(): Promise<typeof import("node:sqlite") | null> {
  if (sqliteModule) return sqliteModule;

  // Suppress the ExperimentalWarning for SQLite
  const orig = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const msg =
      typeof warning === "string" ? warning : (warning?.message ?? "");
    if (msg.includes("SQLite is an experimental feature")) return;
    return (orig as Function)(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    sqliteModule = await import("node:sqlite");
    return sqliteModule;
  } catch {
    return null;
  } finally {
    process.emitWarning = orig;
  }
}

/**
 * Check if the current Node version supports the readBigInts option
 * (available from Node 24.4+).
 */
function supportsReadBigInts(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 24) return true;
  if (major < 24) return false;
  return minor >= 4;
}

/**
 * Read the Chrome cookie DB meta version.
 * Version >= 24 means cookie values have a 32-byte hash prefix that must
 * be stripped after decryption.
 */
async function readMetaVersion(dbPath: string): Promise<number> {
  const sqlite = await importSqlite();
  if (!sqlite) return 0;

  const opts: Record<string, unknown> = { readOnly: true };
  if (supportsReadBigInts()) opts.readBigInts = true;
  const db = new sqlite.DatabaseSync(dbPath, opts);

  try {
    const rows = db
      .prepare("SELECT value FROM meta WHERE key = 'version'")
      .all() as Array<Record<string, unknown>>;
    const val = rows[0]?.value;
    if (typeof val === "number") return Math.floor(val);
    if (typeof val === "bigint") return Number(val);
    if (typeof val === "string") return parseInt(val, 10) || 0;
    return 0;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Query cookie rows from the SQLite DB for the given host names.
 * Uses expandHosts() to match subdomains and dot-prefixed host_key values.
 * Results are ordered by expires_utc DESC so the freshest cookie wins.
 */
async function queryCookieRows(
  dbPath: string,
  hosts: string[],
): Promise<Array<Record<string, unknown>> | null> {
  const sqlite = await importSqlite();
  if (!sqlite) return null;

  const clauses: string[] = [];
  for (const host of hosts) {
    for (const candidate of expandHosts(host)) {
      const esc = candidate.replaceAll("'", "''");
      clauses.push(`host_key = '${esc}'`);
      clauses.push(`host_key = '.${esc}'`);
      clauses.push(`host_key LIKE '%.${esc}'`);
    }
  }
  const where = clauses.join(" OR ");

  const opts: Record<string, unknown> = { readOnly: true };
  if (supportsReadBigInts()) opts.readBigInts = true;
  const db = new sqlite.DatabaseSync(dbPath, opts);

  try {
    return db
      .prepare(
        `SELECT name, value, host_key, encrypted_value FROM cookies WHERE (${where}) ORDER BY expires_utc DESC`,
      )
      .all() as Array<Record<string, unknown>>;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Expand a hostname into candidate match values.
 * "gemini.google.com" -> ["gemini.google.com", "google.com"]
 */
function expandHosts(host: string): string[] {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return [host];
  const candidates = new Set<string>();
  candidates.add(host);
  for (let i = 1; i <= parts.length - 2; i++) {
    const c = parts.slice(i).join(".");
    if (c) candidates.add(c);
  }
  return Array.from(candidates);
}

/**
 * Copy a SQLite sidecar file (-wal or -shm) if it exists.
 * Required for consistent reads when the browser has WAL mode active.
 */
function copySidecar(
  srcDb: string,
  targetDb: string,
  suffix: string,
): void {
  const sidecar = `${srcDb}${suffix}`;
  if (!existsSync(sidecar)) return;
  try {
    copyFileSync(sidecar, `${targetDb}${suffix}`);
  } catch {
    // ignore -- sidecar may vanish between check and copy
  }
}
```

- [ ] **Step 6:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 7:** Commit

```bash
git add src/extract/chrome-cookies.ts
git commit -m "feat(extract): add chrome-cookies module for Chromium cookie extraction and decryption"
```

---

## Task 2: Create `tests/extract/chrome-cookies.test.ts`

**Files:** `tests/extract/chrome-cookies.test.ts`

- [ ] **Step 1:** Create the test file with mocked dependencies

The key testing challenge is that chrome-cookies uses `node:sqlite` (dynamic import) and `node:child_process` (execFile). We mock both, plus `node:fs` and `node:os` for filesystem and platform behavior.

```typescript
// tests/extract/chrome-cookies.test.ts
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock node:sqlite -- provide controllable query results
const mockAll = vi.fn().mockReturnValue([]);
const mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
const mockClose = vi.fn();

vi.mock("node:sqlite", () => ({
  DatabaseSync: vi.fn().mockImplementation(() => ({
    prepare: mockPrepare,
    close: mockClose,
  })),
}));

/**
 * Helper: create an AES-128-CBC encrypted cookie value with vNN prefix,
 * matching Chrome's actual encryption format.
 */
function encryptCookieValue(
  plaintext: string,
  password: string,
  iterations: number,
  prefix: "v10" | "v11" = "v10",
): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
  const iv = Buffer.alloc(16, 0x20);
  const cipher = createDecipheriv("aes-128-cbc", key, iv);
  // createCipheriv for encryption
  const crypto = require("node:crypto");
  const enc = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    Buffer.from(prefix),
    enc.update(plaintext, "utf8"),
    enc.final(),
  ]);
}

describe("chrome-cookies", () => {
  let execFileMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const childProcess = await import("node:child_process");
    execFileMock = childProcess.execFile as unknown as ReturnType<
      typeof vi.fn
    >;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getGoogleCookies", () => {
    it("returns null when no browser cookie DB exists", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();
      expect(result).toBeNull();
    });

    it("returns null on unsupported platform", async () => {
      vi.spyOn(os, "platform").mockReturnValue("win32" as NodeJS.Platform);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();
      expect(result).toBeNull();
    });

    it("returns cookies when DB exists and decryption succeeds (macOS)", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-chrome-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      // Mock keychain password retrieval
      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "test-password\n");
        },
      );

      const password = "test-password";
      const encrypted = encryptCookieValue(
        "test-session-id",
        password,
        1003,
      );

      // First call: readMetaVersion query -> return version 24
      // Second call: cookie rows query
      let queryCallCount = 0;
      mockAll.mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 1) {
          // meta version query
          return [{ value: 24 }];
        }
        // cookie rows query
        return [
          {
            name: "__Secure-1PSID",
            value: "",
            host_key: ".google.com",
            encrypted_value: encrypted,
          },
          {
            name: "__Secure-1PSIDTS",
            value: "plain-sidts-value",
            host_key: ".google.com",
            encrypted_value: new Uint8Array(0),
          },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSIDTS"]).toBe("plain-sidts-value");
    });

    it("returns null when required cookies are missing", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-chrome-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "test-password\n");
        },
      );

      let queryCallCount = 0;
      mockAll.mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ value: 20 }];
        // Only one of the two required cookies
        return [
          {
            name: "__Secure-1PSID",
            value: "some-value",
            host_key: ".google.com",
            encrypted_value: new Uint8Array(0),
          },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies({
        requiredCookies: ["__Secure-1PSID", "__Secure-1PSIDTS"],
      });
      expect(result).toBeNull();
    });

    it("returns null when keychain password retrieval fails", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(new Error("Security: password not found"), "");
        },
      );

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();
      expect(result).toBeNull();
    });

    it("uses 'peanuts' fallback on Linux when secret-tool fails", async () => {
      vi.spyOn(os, "platform").mockReturnValue("linux");
      vi.spyOn(os, "homedir").mockReturnValue("/home/test");
      vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-chrome-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(new Error("secret-tool not found"), "");
        },
      );

      // Create encrypted cookie with "peanuts" password (Linux fallback, 1 iteration)
      const encrypted = encryptCookieValue(
        "linux-session-id",
        "peanuts",
        1,
        "v11",
      );

      let queryCallCount = 0;
      mockAll.mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ value: 20 }]; // meta version < 24
        return [
          {
            name: "__Secure-1PSID",
            value: "",
            host_key: ".google.com",
            encrypted_value: encrypted,
          },
          {
            name: "__Secure-1PSIDTS",
            value: "",
            host_key: ".google.com",
            encrypted_value: encrypted,
          },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe("linux-session-id");
    });

    it("copies DB and sidecar files to temp before querying", async () => {
      const copySpy = vi
        .spyOn(fs, "copyFileSync")
        .mockImplementation(() => {});
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-chrome-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "password\n");
        },
      );

      mockAll.mockReturnValue([]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      await getGoogleCookies();

      // Main Cookies file + -wal + -shm = 3 copy attempts
      // (existsSync returns true for all, so all 3 are copied)
      expect(copySpy).toHaveBeenCalledWith(
        expect.stringContaining("Cookies"),
        expect.stringContaining("/tmp/pi-chrome-cookies-test"),
      );
    });

    it("accepts custom profile name", async () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      await getGoogleCookies({ profile: "Profile 1" });

      expect(existsSpy).toHaveBeenCalledWith(
        expect.stringContaining("Profile 1"),
      );
    });

    it("filters cookies through the allowlist", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(os, "tmpdir").mockReturnValue("/tmp");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-chrome-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: object,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "password\n");
        },
      );

      let queryCallCount = 0;
      mockAll.mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ value: 20 }];
        return [
          {
            name: "__Secure-1PSID",
            value: "sid-value",
            host_key: ".google.com",
            encrypted_value: new Uint8Array(0),
          },
          {
            name: "UNKNOWN_COOKIE",
            value: "should-be-filtered",
            host_key: ".google.com",
            encrypted_value: new Uint8Array(0),
          },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe("sid-value");
      expect(result!.cookies["UNKNOWN_COOKIE"]).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2:** Run tests

```bash
pnpm vitest run tests/extract/chrome-cookies.test.ts
```

- [ ] **Step 3:** Fix any test failures and iterate until green

- [ ] **Step 4:** Commit

```bash
git add tests/extract/chrome-cookies.test.ts
git commit -m "test(extract): add chrome-cookies tests with mocked sqlite and execFile"
```

---

## Task 3: Create `src/extract/gemini-web.ts`

**Files:** `src/extract/gemini-web.ts`

Port from `nicobailon-pi-web-access/gemini-web.ts`, adapting to pi-tools conventions:
- Use `loadConfig()` from `src/config.ts` (same pattern as `gemini-api.ts`) instead of a separate config module
- Top-level imports only (no inline `await import(...)`)
- Follow `gemini-api.ts` config-caching pattern

- [ ] **Step 1:** Create the file with imports, types, and constants

```typescript
// src/extract/gemini-web.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig } from "../config.ts";
import type { CookieMap } from "./chrome-cookies.ts";
import { getGoogleCookies } from "./chrome-cookies.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 10;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const MODEL_HEADERS: Record<string, string> = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiWebOptions {
  youtubeUrl?: string;
  files?: string[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface GeminiWebResult {
  text: string;
  errorCode?: number;
  errorMessage?: string;
}
```

- [ ] **Step 2:** Add config/availability functions

```typescript
// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Check if browser cookie access is allowed via env var or config.
 * Mirrors gemini-api.ts lazy config pattern.
 */
export function isBrowserCookieAccessAllowed(): boolean {
  if (process.env.PI_ALLOW_BROWSER_COOKIES === "1") return true;
  try {
    const config = loadConfig();
    return config.gemini?.allowBrowserCookies === true;
  } catch {
    return false;
  }
}

/**
 * Normalize a chrome profile string: trim whitespace, return undefined
 * for empty/non-string values.
 */
function normalizeChromeProfile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Get the configured Chrome profile name from config.
 */
function getChromeProfileFromConfig(): string | undefined {
  try {
    return normalizeChromeProfile(loadConfig().gemini?.chromeProfile);
  } catch {
    return undefined;
  }
}

/**
 * Check if Gemini Web is available by verifying cookie access permission
 * and extracting valid Google cookies from a local browser.
 * Returns the cookie map if available, null otherwise.
 */
export async function isGeminiWebAvailable(
  chromeProfile?: string,
): Promise<CookieMap | null> {
  if (!isBrowserCookieAccessAllowed()) return null;

  const result = await getGoogleCookies({
    profile:
      normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),
    requiredCookies: REQUIRED_COOKIES,
  });

  if (!result) return null;
  return result.cookies;
}
```

- [ ] **Step 3:** Add the main `queryWithCookies` function

```typescript
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query Gemini Web using extracted browser cookies.
 * Supports model selection, file uploads, and YouTube URL inclusion.
 * Falls back to gemini-2.5-flash if the requested model is unavailable.
 */
export async function queryWithCookies(
  prompt: string,
  cookieMap: CookieMap,
  options: GeminiWebOptions = {},
): Promise<string> {
  const model =
    options.model && MODEL_HEADERS[options.model]
      ? options.model
      : DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let fullPrompt = prompt;
  if (options.youtubeUrl) {
    fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
  }

  const result = await runGeminiWebOnce(
    fullPrompt,
    cookieMap,
    model,
    options.files,
    timeoutMs,
    options.signal,
  );

  // If model unavailable and not already flash, retry with flash
  if (isModelUnavailable(result.errorCode) && model !== DEFAULT_MODEL) {
    const fallback = await runGeminiWebOnce(
      fullPrompt,
      cookieMap,
      DEFAULT_MODEL,
      options.files,
      timeoutMs,
      options.signal,
    );
    if (fallback.errorMessage) throw new Error(fallback.errorMessage);
    if (!fallback.text)
      throw new Error("Gemini Web returned empty response (fallback model)");
    return fallback.text;
  }

  if (result.errorMessage) throw new Error(result.errorMessage);
  if (!result.text) throw new Error("Gemini Web returned empty response");
  return result.text;
}
```

- [ ] **Step 4:** Add the core request function with redirect-aware token fetch

```typescript
// ---------------------------------------------------------------------------
// Internal request pipeline
// ---------------------------------------------------------------------------

/**
 * Single attempt to query Gemini Web with a specific model.
 * Returns a result object rather than throwing, so the caller can inspect
 * errorCode for model-unavailable fallback logic.
 */
async function runGeminiWebOnce(
  prompt: string,
  cookieMap: CookieMap,
  model: string,
  files: string[] | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GeminiWebResult> {
  const effectiveSignal = withTimeout(signal, timeoutMs);
  const cookieHeader = buildCookieHeader(cookieMap);
  const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);

  const uploaded: Array<{ id: string; name: string }> = [];
  if (files) {
    for (const filePath of files) {
      uploaded.push(
        await uploadFile(filePath, cookieHeader, effectiveSignal),
      );
    }
  }

  const fReq = buildFReqPayload(prompt, uploaded);
  const params = new URLSearchParams();
  params.set("at", accessToken);
  params.set("f.req", fReq);

  const res = await fetch(GEMINI_STREAM_GENERATE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      host: "gemini.google.com",
      origin: "https://gemini.google.com",
      referer: "https://gemini.google.com/",
      "x-same-domain": "1",
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
      [MODEL_HEADER_NAME]: MODEL_HEADERS[model],
    },
    body: params.toString(),
    signal: effectiveSignal,
  });

  const rawText = await res.text();

  if (!res.ok) {
    return {
      text: "",
      errorMessage: `Gemini Web request failed: ${res.status}`,
    };
  }

  try {
    return parseStreamGenerateResponse(rawText);
  } catch (err) {
    let errorCode: number | undefined;
    try {
      const json = JSON.parse(trimJsonEnvelope(rawText));
      errorCode = extractErrorCode(json);
    } catch {
      // can't parse error code from malformed response
    }
    return {
      text: "",
      errorCode,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 5:** Add token fetch with cookie-aware redirect following

```typescript
/**
 * Fetch the access token (SNlM0e or thykhd) from the Gemini app page.
 * Manually follows redirects to preserve cookies across auth bounces.
 */
async function fetchAccessToken(
  cookieHeader: string,
  signal: AbortSignal,
): Promise<string> {
  const html = await fetchWithCookieRedirects(
    GEMINI_APP_URL,
    cookieHeader,
    MAX_REDIRECTS,
    signal,
  );

  for (const key of ["SNlM0e", "thykhd"]) {
    const match = html.match(new RegExp(`"${key}":"(.*?)"`));
    if (match?.[1]) return match[1];
  }

  throw new Error(
    "Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in a supported Chromium-based browser.",
  );
}

/**
 * Fetch a URL with manual redirect following that preserves cookies.
 * Native fetch's automatic redirect drops custom Cookie headers.
 */
async function fetchWithCookieRedirects(
  url: string,
  cookieHeader: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<string> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, {
      headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
    }
    return await res.text();
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}
```

- [ ] **Step 6:** Add file upload and payload building

```typescript
// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to Google's content-push service using multipart/form-data.
 */
async function uploadFile(
  filePath: string,
  cookieHeader: string,
  signal: AbortSignal,
): Promise<{ id: string; name: string }> {
  const data = readFileSync(filePath);
  const fileName = basename(filePath);
  const boundary =
    "----FormBoundary" + Math.random().toString(36).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, "utf-8"),
    data,
    Buffer.from(footer, "utf-8"),
  ]);

  const res = await fetch(GEMINI_UPLOAD_URL, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "push-id": GEMINI_UPLOAD_PUSH_ID,
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
    },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `File upload failed: ${res.status} (${text.slice(0, 200)})`,
    );
  }

  return { id: await res.text(), name: fileName };
}

// ---------------------------------------------------------------------------
// Request payload
// ---------------------------------------------------------------------------

/**
 * Build the fReq payload for BardChatUi StreamGenerate.
 * Format: JSON.stringify([null, JSON.stringify(innerList)])
 */
function buildFReqPayload(
  prompt: string,
  uploaded: Array<{ id: string; name: string }>,
): string {
  const promptPayload =
    uploaded.length > 0
      ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])]
      : [prompt];
  const innerList = [promptPayload, null, null];
  return JSON.stringify([null, JSON.stringify(innerList)]);
}
```

- [ ] **Step 7:** Add response parsing helpers

```typescript
// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the streaming response from BardChatUi.
 * The response is an array of parts; each part at index [2] is a JSON
 * string containing candidate text at path [4][0][1][0].
 */
function parseStreamGenerateResponse(rawText: string): GeminiWebResult {
  const responseJson = JSON.parse(trimJsonEnvelope(rawText));
  const errorCode = extractErrorCode(responseJson);

  const parts = Array.isArray(responseJson) ? responseJson : [];
  let firstCandidateSeen: unknown = undefined;
  let latestNonEmptyText = "";

  for (let i = 0; i < parts.length; i++) {
    const partBody = getNestedValue(parts[i], [2]);
    if (!partBody || typeof partBody !== "string") continue;
    try {
      const parsed = JSON.parse(partBody);
      const candidateList = getNestedValue(parsed, [4]);
      if (!Array.isArray(candidateList) || candidateList.length === 0)
        continue;

      const firstCandidate = (candidateList as unknown[])[0];
      if (firstCandidateSeen === undefined)
        firstCandidateSeen = firstCandidate;

      const text = extractCandidateText(firstCandidate);
      if (text.length > 0) latestNonEmptyText = text;
    } catch {
      // inner JSON parse failure -- skip this part
    }
  }

  const text =
    latestNonEmptyText.length > 0
      ? latestNonEmptyText
      : extractCandidateText(firstCandidateSeen);

  return { text, errorCode };
}

/**
 * Extract the main text from a candidate response entry.
 * Falls back to index [22][0] if the primary text looks like a
 * googleusercontent card URL.
 */
function extractCandidateText(candidate: unknown): string {
  const textRaw = getNestedValue(candidate, [1, 0]);
  let text = typeof textRaw === "string" ? textRaw : "";

  if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
    const alt = getNestedValue(candidate, [22, 0]);
    if (typeof alt === "string" && alt.length > 0) text = alt;
  }

  return text;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function buildCookieHeader(cookieMap: CookieMap): string {
  return Object.entries(cookieMap)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getNestedValue(value: unknown, pathParts: number[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (current == null) return undefined;
    if (!Array.isArray(current)) return undefined;
    current = (current as unknown[])[part];
  }
  return current;
}

/**
 * Find the outermost JSON array in the response text.
 * The BardChatUi streaming response wraps JSON in length-prefixed lines.
 */
function trimJsonEnvelope(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON payload.");
  }
  return text.slice(start, end + 1);
}

function extractErrorCode(responseJson: unknown): number | undefined {
  const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
  return typeof code === "number" && code >= 0 ? code : undefined;
}

/**
 * Model unavailable is indicated by error code 1052 in the response
 * structure, not by string matching on error messages.
 */
function isModelUnavailable(errorCode: number | undefined): boolean {
  return errorCode === 1052;
}
```

- [ ] **Step 8:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 9:** Commit

```bash
git add src/extract/gemini-web.ts
git commit -m "feat(extract): add gemini-web module with cookie-auth client and streaming parser"
```

---

## Task 4: Create `tests/extract/gemini-web.test.ts`

**Files:** `tests/extract/gemini-web.test.ts`

Tests must use mock response formats that match the actual `parseStreamGenerateResponse` logic (outer array with parts at index [2] containing stringified JSON with candidates at [4]).

- [ ] **Step 1:** Create the test file

```typescript
// tests/extract/gemini-web.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

// Mock chrome-cookies module
vi.mock("../../src/extract/chrome-cookies.ts", () => ({
  getGoogleCookies: vi.fn(),
}));

/**
 * Build a mock streaming response matching BardChatUi's actual format.
 *
 * Real format: outer JSON array where each element has a stringified
 * JSON payload at index [2]. That inner payload has candidates at index [4].
 * Candidate text is at candidate[1][0].
 */
function buildMockStreamResponse(text: string): string {
  const candidatePayload = JSON.stringify([
    null, // [0]
    null, // [1]
    null, // [2]
    null, // [3]
    [[[null, [text]]]], // [4] -> candidates -> [0] -> [1] -> [0] = text
  ]);
  // Outer array: one part with the inner payload at index [2]
  const outer = JSON.stringify([[null, null, candidatePayload]]);
  return outer;
}

/**
 * Build a mock response where the token page HTML contains SNlM0e.
 */
function tokenPageHtml(token: string): string {
  return `<html><script>data:"SNlM0e":"${token}"</script></html>`;
}

describe("gemini-web", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("isBrowserCookieAccessAllowed", () => {
    it("returns true when PI_ALLOW_BROWSER_COOKIES=1", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { isBrowserCookieAccessAllowed } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(isBrowserCookieAccessAllowed()).toBe(true);
    });

    it("returns false when env var is not set", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");

      const { isBrowserCookieAccessAllowed } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(isBrowserCookieAccessAllowed()).toBe(false);
    });
  });

  describe("isGeminiWebAvailable", () => {
    it("returns null when cookie access is not allowed", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await isGeminiWebAvailable();
      expect(result).toBeNull();
    });

    it("returns cookies when access is allowed and cookies exist", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      (getGoogleCookies as ReturnType<typeof vi.fn>).mockResolvedValue({
        cookies: {
          "__Secure-1PSID": "sid-value",
          "__Secure-1PSIDTS": "sidts-value",
        },
        warnings: [],
      });

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await isGeminiWebAvailable();
      expect(result).toEqual({
        "__Secure-1PSID": "sid-value",
        "__Secure-1PSIDTS": "sidts-value",
      });
    });

    it("returns null when cookies cannot be extracted", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      (getGoogleCookies as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await isGeminiWebAvailable();
      expect(result).toBeNull();
    });
  });

  describe("queryWithCookies", () => {
    const mockCookies = {
      "__Secure-1PSID": "test-sid",
      "__Secure-1PSIDTS": "test-sidts",
      SID: "test-general-sid",
    };

    it("fetches access token and returns parsed response text", async () => {
      // Token page -- stubFetch uses url.includes() matching
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("test-token-123"),
        headers: { "content-type": "text/html" },
      });

      // StreamGenerate response
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("Hello from Gemini!"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test prompt", mockCookies);
      expect(result).toBe("Hello from Gemini!");
    });

    it("includes YouTube URL in prompt when provided", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token-456"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("Video summary here"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("summarize this", mockCookies, {
        youtubeUrl: "https://youtube.com/watch?v=abc123",
      });
      expect(result).toBe("Video summary here");

      // Verify prompt was augmented with YouTube URL
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      expect(streamCall).toBeDefined();
      const body = streamCall![1].body as string;
      expect(body).toContain("youtube.com");
    });

    it("sends model header for known models", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies, {
        model: "gemini-2.5-pro",
      });

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      expect(streamCall).toBeDefined();
      expect(
        streamCall![1].headers["x-goog-ext-525001261-jspb"],
      ).toBe(
        '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
      );
    });

    it("falls back to flash for unknown model names", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies, {
        model: "gemini-unknown-model",
      });

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      // Should use flash header since unknown model falls back
      expect(
        streamCall![1].headers["x-goog-ext-525001261-jspb"],
      ).toBe(
        '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
      );
    });

    it("throws when access token cannot be extracted", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: "<html>No token here</html>",
        headers: { "content-type": "text/html" },
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies),
      ).rejects.toThrow("Unable to authenticate with Gemini");
    });

    it("returns error on non-2xx response from StreamGenerate", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        status: 429,
        body: "Rate limited",
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies),
      ).rejects.toThrow("Gemini Web request failed: 429");
    });

    it("respects timeout option", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });

      // Replace fetch with one that waits for abort
      fetchStub.restore();
      globalThis.fetch = vi.fn(
        async (url: string | URL, init?: RequestInit) => {
          const urlStr = url instanceof URL ? url.href : url;
          if (urlStr.includes("gemini.google.com/app")) {
            return new Response(tokenPageHtml("token"), { status: 200 });
          }
          // Wait until aborted
          await new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
          return new Response("", { status: 200 });
        },
      ) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies, { timeoutMs: 50 }),
      ).rejects.toThrow();
    });

    it("uploads files when provided", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("content-push.googleapis.com", {
        status: 200,
        body: "upload-id-123",
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("File analyzed"),
      });

      // Mock readFileSync for the file read
      const fsMod = await import("node:fs");
      vi.spyOn(fsMod, "readFileSync").mockReturnValue(
        Buffer.from("fake file content"),
      );

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("analyze this", mockCookies, {
        files: ["/tmp/test.png"],
      });
      expect(result).toBe("File analyzed");
    });

    it("sends required headers (x-same-domain, user-agent, host)", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: tokenPageHtml("token"),
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies);

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      const headers = streamCall![1].headers;
      expect(headers["x-same-domain"]).toBe("1");
      expect(headers["user-agent"]).toBeDefined();
      expect(headers.host).toBe("gemini.google.com");
      expect(headers.cookie).toContain("__Secure-1PSID=test-sid");
    });
  });
});
```

- [ ] **Step 2:** Run tests

```bash
pnpm vitest run tests/extract/gemini-web.test.ts
```

- [ ] **Step 3:** Fix any test/implementation mismatches

The mock `buildMockStreamResponse` must produce output that `parseStreamGenerateResponse` can parse. If tests fail on parsing, debug by comparing the mock structure against the `getNestedValue` paths used in parsing (`[i][2]` for the inner JSON string, `[4]` for candidates, `[0][1][0]` for text).

- [ ] **Step 4:** Commit

```bash
git add tests/extract/gemini-web.test.ts
git commit -m "test(extract): add gemini-web tests with mocked fetch and chrome-cookies"
```

---

## Task 5: Integration Verification and Cleanup

**Files:** All files from Tasks 1-4

- [ ] **Step 1:** Run both test files together

```bash
pnpm vitest run tests/extract/chrome-cookies.test.ts tests/extract/gemini-web.test.ts
```

- [ ] **Step 2:** Run the full test suite to check for regressions

```bash
pnpm test
```

- [ ] **Step 3:** Run lint and typecheck

```bash
pnpm run lint
pnpm run typecheck
```

- [ ] **Step 4:** Fix any issues discovered

Common issues to watch for:
- Import resolution: ensure `chrome-cookies.ts` and `gemini-web.ts` can be imported from other modules
- Type compatibility: `CookieMap` type must be consistent across modules
- No unused imports or variables (biome lint)
- No inline imports (all imports must be top-level)
- `readFileSync` in gemini-web.ts must be imported from `node:fs` at the top level

- [ ] **Step 5:** Create fix commit if needed (only stage files you changed)

```bash
git add src/extract/chrome-cookies.ts src/extract/gemini-web.ts tests/extract/chrome-cookies.test.ts tests/extract/gemini-web.test.ts
git commit -m "fix(extract): address lint/type issues in chrome-cookies and gemini-web"
```

---

## Final Verification

```bash
pnpm vitest run tests/extract/chrome-cookies.test.ts tests/extract/gemini-web.test.ts
pnpm test
pnpm run lint
pnpm run typecheck
```

All must pass with zero errors.

**Summary of deliverables:**

| File | Purpose |
|------|---------|
| `src/extract/chrome-cookies.ts` | Cookie extraction from Chromium browsers (macOS/Linux), AES-128-CBC decryption, meta version check, WAL sidecar support |
| `src/extract/gemini-web.ts` | Gemini Web cookie-auth client (redirect-aware token fetch, multipart file upload, streaming response parsing, error code 1052 model fallback) |
| `tests/extract/chrome-cookies.test.ts` | Tests: decryption, DB query, platform-specific paths, cookie allowlist filtering, error handling |
| `tests/extract/gemini-web.test.ts` | Tests: cookie check, token fetch, model headers, unknown model fallback, required headers, file upload, timeout |

**Key differences from previous plan (corrected against reference implementation):**

1. **chrome-cookies**: Helium keychain service name fixed, `process.emitWarning` suppression, `expandHosts()` for subdomain matching, `ALL_COOKIE_NAMES` allowlist, `readBigInts` support, meta version check for hash stripping, WAL/SHM sidecar copies, `readOnly: true` DB option, `/^v\d\d$/` prefix regex, `TextDecoder` with fatal + control char stripping, module-scoped sqlite cache, `ORDER BY expires_utc DESC`
2. **gemini-web**: `loadConfig()` import (no CJS require), `fetchWithCookieRedirects()` with `redirect: "manual"`, correct fReq format (`JSON.stringify([null, JSON.stringify(innerList)])`), `URLSearchParams` body encoding, `trimJsonEnvelope` + `getNestedValue` response parsing, error code 1052 for model unavailability, multipart/form-data file upload, all required headers (`x-same-domain`, `host`, `user-agent`), top-level `readFileSync` import
3. **Tests**: mock response format matches actual parser structure, verified header assertions
