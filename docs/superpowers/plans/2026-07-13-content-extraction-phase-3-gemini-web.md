# Content Extraction Phase 3: Chrome Cookie Extraction & Gemini Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/chrome-cookies.ts` and `src/extract/gemini-web.ts` — cookie extraction from Chromium browsers and Gemini Web client using those cookies for authenticated access to Gemini without an API key.

**Architecture:** Two modules: (1) chrome-cookies reads encrypted cookie databases from local Chromium-based browsers and decrypts them using OS keychain credentials; (2) gemini-web uses those cookies to authenticate against Google's Gemini web interface (BardChatUi) for model inference. The cookie module handles macOS and Linux decryption paths. The Gemini Web client handles access token parsing, file uploads, model selection, and streaming response parsing.

**Tech Stack:** TypeScript, Vitest, `node:sqlite` (dynamic import), `node:crypto` (pbkdf2Sync, createDecipheriv), `node:child_process` (execFile with timeout), native `fetch`

**Parent Plan:** `2026-07-13-content-extraction.md`
**Prerequisite:** Phase 2 complete (gemini-api.ts exists)

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `src/extract/pipeline.ts` | Main extraction orchestrator (modified in Phase 7) |
| `src/extract/gemini-api.ts` | Gemini REST API client (created in Phase 2) |
| `src/config.ts` | Config loading, key resolution |
| `tests/helpers.ts` | `stubFetch()`, `stubExec()`, `createMockPi` test utilities |

---

## Task 1: Create `src/extract/chrome-cookies.ts`

**Files:** `src/extract/chrome-cookies.ts`

- [ ] **Step 1:** Create the file with type exports and browser profile definitions

```typescript
// src/extract/chrome-cookies.ts
import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type CookieMap = Record<string, string>;

interface BrowserProfile {
  name: string;
  /** Path relative to home directory */
  cookieDir: string;
  /** macOS keychain service name */
  keychainService?: string;
  /** macOS keychain account */
  keychainAccount?: string;
  /** Linux secret-tool application name */
  linuxApp?: string;
}

const MAC_BROWSERS: BrowserProfile[] = [
  {
    name: "Chrome",
    cookieDir: "Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  },
  {
    name: "Arc",
    cookieDir: "Library/Application Support/Arc/User Data",
    keychainService: "Arc Safe Storage",
    keychainAccount: "Arc",
  },
  {
    name: "Helium",
    cookieDir: "Library/Application Support/net.imput.helium",
    keychainService: "Helium Safe Storage",
    keychainAccount: "Helium",
  },
];

const LINUX_BROWSERS: BrowserProfile[] = [
  {
    name: "Chrome",
    cookieDir: ".config/google-chrome",
    linuxApp: "chrome",
  },
  {
    name: "Chromium",
    cookieDir: ".config/chromium",
    linuxApp: "chromium",
  },
];

const GOOGLE_HOST_KEYS = [
  ".google.com",
  "gemini.google.com",
  ".gemini.google.com",
  "accounts.google.com",
  ".accounts.google.com",
  "www.google.com",
  ".www.google.com",
];

const REQUIRED_COOKIES_DEFAULT = ["__Secure-1PSID", "__Secure-1PSIDTS"];

const KEYCHAIN_TIMEOUT_MS = 5000;

/**
 * Extract Google cookies from a local Chromium-based browser.
 * Returns decrypted cookie map or null if extraction fails.
 */
export async function getGoogleCookies(options?: {
  profile?: string;
  requiredCookies?: string[];
}): Promise<{ cookies: CookieMap; warnings: string[] } | null> {
  const profile = options?.profile ?? "Default";
  const requiredCookies = options?.requiredCookies ?? REQUIRED_COOKIES_DEFAULT;
  const platform = os.platform();
  const browsers = platform === "darwin" ? MAC_BROWSERS : LINUX_BROWSERS;

  for (const browser of browsers) {
    const result = await tryBrowser(browser, profile, requiredCookies, platform);
    if (result) return result;
  }

  return null;
}

async function tryBrowser(
  browser: BrowserProfile,
  profile: string,
  requiredCookies: string[],
  platform: string,
): Promise<{ cookies: CookieMap; warnings: string[] } | null> {
  const warnings: string[] = [];
  const home = os.homedir();
  const cookieDbPath = path.join(home, browser.cookieDir, profile, "Cookies");

  if (!fs.existsSync(cookieDbPath)) return null;

  // Copy DB to temp to avoid locking
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cookies-"));
  const tmpDb = path.join(tmpDir, "Cookies");

  try {
    fs.copyFileSync(cookieDbPath, tmpDb);

    // Get decryption password
    const password = await getDecryptionPassword(browser, platform);
    if (!password) {
      warnings.push(`Failed to get keychain password for ${browser.name}`);
      return null;
    }

    // Derive key
    const iterations = platform === "darwin" ? 1003 : 1;
    const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");

    // Query cookies
    const rawCookies = await queryCookieDb(tmpDb);
    if (!rawCookies || rawCookies.length === 0) {
      warnings.push(`No Google cookies found in ${browser.name}`);
      return null;
    }

    // Decrypt
    const cookies: CookieMap = {};
    for (const row of rawCookies) {
      const { name, value, encrypted_value } = row;
      if (value) {
        cookies[name] = value;
      } else if (encrypted_value && encrypted_value.length > 0) {
        const decrypted = decryptCookieValue(encrypted_value, key);
        if (decrypted) cookies[name] = decrypted;
      }
    }

    // Check required cookies
    const missing = requiredCookies.filter((c) => !cookies[c]);
    if (missing.length > 0) {
      warnings.push(
        `${browser.name}: missing required cookies: ${missing.join(", ")}`,
      );
      return null;
    }

    return { cookies, warnings };
  } finally {
    // Cleanup temp
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function getDecryptionPassword(
  browser: BrowserProfile,
  platform: string,
): Promise<string | null> {
  if (platform === "darwin") {
    return getMacPassword(browser);
  }
  return getLinuxPassword(browser);
}

function getMacPassword(browser: BrowserProfile): Promise<string | null> {
  return new Promise((resolve) => {
    const account = browser.keychainAccount ?? browser.name;
    const service = browser.keychainService ?? `${browser.name} Safe Storage`;

    const child = execFile(
      "security",
      [
        "find-generic-password",
        "-w",
        "-a",
        account,
        "-s",
        service,
      ],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(stdout.trim() || null);
      },
    );
    // Extra safety: kill on timeout
    setTimeout(() => child.kill(), KEYCHAIN_TIMEOUT_MS + 500);
  });
}

function getLinuxPassword(browser: BrowserProfile): Promise<string | null> {
  return new Promise((resolve) => {
    const app = browser.linuxApp ?? "chrome";

    execFile(
      "secret-tool",
      [
        "lookup",
        "xdg:schema",
        "chrome_libsecret_os_crypt_password_v2",
        "application",
        app,
      ],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          // Fallback to "peanuts" (Chromium default when no keyring)
          resolve("peanuts");
          return;
        }
        resolve(stdout.trim() || "peanuts");
      },
    );
  });
}

interface RawCookie {
  name: string;
  value: string;
  encrypted_value: Buffer;
}

async function queryCookieDb(dbPath: string): Promise<RawCookie[] | null> {
  try {
    // Suppress experimental warning for node:sqlite
    const originalEmit = process.emit.bind(process);
    const suppressedEmit = (event: string, ...args: unknown[]) => {
      if (
        event === "warning" &&
        args[0] &&
        typeof args[0] === "object" &&
        "name" in args[0] &&
        (args[0] as { name: string }).name === "ExperimentalWarning" &&
        "message" in args[0] &&
        String((args[0] as { message: string }).message).includes("SQLite")
      ) {
        return false;
      }
      return originalEmit(event, ...(args as Parameters<typeof originalEmit> extends [string, ...infer R] ? R : never));
    };
    process.emit = suppressedEmit as typeof process.emit;

    const sqlite = await import("node:sqlite");
    process.emit = originalEmit;

    const db = new sqlite.DatabaseSync(dbPath, { open: true });
    const hostPlaceholders = GOOGLE_HOST_KEYS.map(() => "?").join(", ");
    const stmt = db.prepare(
      `SELECT name, value, encrypted_value FROM cookies WHERE host_key IN (${hostPlaceholders})`,
    );
    const rows = stmt.all(...GOOGLE_HOST_KEYS) as Array<{
      name: string;
      value: string;
      encrypted_value: Buffer;
    }>;
    db.close();

    return rows;
  } catch {
    return null;
  }
}

/**
 * Decrypt a Chromium cookie value.
 * - Strips "v10"/"v11" prefix (3 bytes)
 * - AES-128-CBC with IV of 16 x 0x20 bytes
 * - Removes PKCS7 padding
 * - Chrome v24+: strips first 32 bytes of plaintext (hash prefix)
 */
function decryptCookieValue(encrypted: Buffer, key: Buffer): string | null {
  try {
    if (encrypted.length < 4) return null;

    // Check for v10/v11 prefix
    const prefix = encrypted.subarray(0, 3).toString("ascii");
    if (prefix !== "v10" && prefix !== "v11") return null;

    const ciphertext = encrypted.subarray(3);
    if (ciphertext.length === 0) return null;

    // IV: 16 bytes of 0x20 (space character)
    const iv = Buffer.alloc(16, 0x20);

    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    // Remove PKCS7 padding
    const padLen = decrypted[decrypted.length - 1];
    if (padLen > 0 && padLen <= 16) {
      decrypted = decrypted.subarray(0, decrypted.length - padLen);
    }

    let plaintext = decrypted.toString("utf8");

    // Chrome v24+: strip 32-byte hash prefix if present
    if (plaintext.length > 32 && /^[0-9a-f]{32}/.test(plaintext)) {
      plaintext = plaintext.slice(32);
    }

    return plaintext || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/extract/chrome-cookies.ts
git commit -m "feat(extract): add chrome-cookies module for Chromium cookie extraction and decryption"
```

---

## Task 2: Create `tests/extract/chrome-cookies.test.ts`

**Files:** `tests/extract/chrome-cookies.test.ts`

- [ ] **Step 1:** Create the test file with mocked dependencies

```typescript
// tests/extract/chrome-cookies.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock node:sqlite
vi.mock("node:sqlite", () => {
  const mockAll = vi.fn().mockReturnValue([]);
  const mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
  const mockClose = vi.fn();
  return {
    DatabaseSync: vi.fn().mockImplementation(() => ({
      prepare: mockPrepare,
      close: mockClose,
    })),
    __mockAll: mockAll,
    __mockPrepare: mockPrepare,
  };
});

describe("chrome-cookies", () => {
  let execFileMock: ReturnType<typeof vi.fn>;
  let mockAll: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const childProcess = await import("node:child_process");
    execFileMock = childProcess.execFile as unknown as ReturnType<typeof vi.fn>;
    const sqlite = await import("node:sqlite");
    mockAll = (sqlite as unknown as { __mockAll: ReturnType<typeof vi.fn> }).__mockAll;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getGoogleCookies", () => {
    it("returns null when no browser cookie DB exists", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();
      expect(result).toBeNull();
    });

    it("returns cookies when DB exists and decryption succeeds (macOS)", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
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
          return { kill: vi.fn() };
        },
      );

      // Create an encrypted cookie value for testing
      const password = "test-password";
      const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
      const iv = Buffer.alloc(16, 0x20);
      const cipher = require("node:crypto").createCipheriv(
        "aes-128-cbc",
        key,
        iv,
      );
      const cookieValue = "test-session-id-value";
      const encrypted = Buffer.concat([
        Buffer.from("v10"),
        cipher.update(cookieValue, "utf8"),
        cipher.final(),
      ]);

      // Mock SQLite query results
      mockAll.mockReturnValue([
        {
          name: "__Secure-1PSID",
          value: "",
          encrypted_value: encrypted,
        },
        {
          name: "__Secure-1PSIDTS",
          value: "",
          encrypted_value: encrypted,
        },
      ]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe(cookieValue);
      expect(result!.cookies["__Secure-1PSIDTS"]).toBe(cookieValue);
    });

    it("returns null when required cookies are missing", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: Function) => {
          cb(null, "test-password\n");
          return { kill: vi.fn() };
        },
      );

      // Only return one required cookie, missing the other
      mockAll.mockReturnValue([
        { name: "__Secure-1PSID", value: "some-value", encrypted_value: Buffer.alloc(0) },
      ]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();
      expect(result).toBeNull();
    });

    it("returns null when keychain password retrieval fails", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: Function) => {
          cb(new Error("Security: password not found"), "");
          return { kill: vi.fn() };
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
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: Function) => {
          cb(new Error("secret-tool not found"), "");
          return { kill: vi.fn() };
        },
      );

      // Create encrypted cookie with "peanuts" password (Linux fallback)
      const key = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
      const iv = Buffer.alloc(16, 0x20);
      const cipher = require("node:crypto").createCipheriv(
        "aes-128-cbc",
        key,
        iv,
      );
      const cookieValue = "linux-session-id";
      const encrypted = Buffer.concat([
        Buffer.from("v11"),
        cipher.update(cookieValue, "utf8"),
        cipher.final(),
      ]);

      mockAll.mockReturnValue([
        { name: "__Secure-1PSID", value: "", encrypted_value: encrypted },
        { name: "__Secure-1PSIDTS", value: "", encrypted_value: encrypted },
      ]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe(cookieValue);
    });

    it("copies DB to temp before querying to avoid locking", async () => {
      const copySpy = vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: Function) => {
          cb(null, "password\n");
          return { kill: vi.fn() };
        },
      );

      mockAll.mockReturnValue([]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      await getGoogleCookies();

      expect(copySpy).toHaveBeenCalledWith(
        expect.stringContaining("Cookies"),
        expect.stringContaining("/tmp/pi-cookies-test"),
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

      // Should check for the custom profile path
      expect(existsSpy).toHaveBeenCalledWith(
        expect.stringContaining("Profile 1"),
      );
    });
  });

  describe("decryption logic", () => {
    it("handles v10 prefix correctly", async () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin");
      vi.spyOn(os, "homedir").mockReturnValue("/Users/test");
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
      vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/pi-cookies-test");
      vi.spyOn(fs, "rmSync").mockImplementation(() => {});

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: object, cb: Function) => {
          cb(null, "my-password\n");
          return { kill: vi.fn() };
        },
      );

      const password = "my-password";
      const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
      const iv = Buffer.alloc(16, 0x20);
      const cipher = require("node:crypto").createCipheriv(
        "aes-128-cbc",
        key,
        iv,
      );
      const value = "decrypted-value-v10";
      const encrypted = Buffer.concat([
        Buffer.from("v10"),
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);

      mockAll.mockReturnValue([
        { name: "__Secure-1PSID", value: "", encrypted_value: encrypted },
        { name: "__Secure-1PSIDTS", value: "plain-value", encrypted_value: Buffer.alloc(0) },
      ]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe(value);
      // Plain value should be used directly
      expect(result!.cookies["__Secure-1PSIDTS"]).toBe("plain-value");
    });
  });
});
```

- [ ] **Step 2:** Run tests (expect some to fail until mocking is tuned)

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

- [ ] **Step 1:** Create the file with exports and config check

```typescript
// src/extract/gemini-web.ts
import type { CookieMap } from "./chrome-cookies.ts";
import { getGoogleCookies } from "./chrome-cookies.ts";

export interface GeminiWebOptions {
  youtubeUrl?: string;
  files?: string[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "gemini-2.5-flash";

const MODEL_HEADERS: Record<string, string> = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

/**
 * Check if browser cookie access is allowed via env var or config.
 */
export function isBrowserCookieAccessAllowed(): boolean {
  if (process.env.PI_ALLOW_BROWSER_COOKIES === "1") return true;

  // Check config: gemini.allowBrowserCookies
  try {
    const { loadConfig } = require("../config.ts");
    const config = loadConfig();
    return (config as Record<string, unknown>)?.gemini?.allowBrowserCookies === true;
  } catch {
    return false;
  }
}

/**
 * Check if Gemini Web is available by verifying cookie access permission
 * and extracting valid Google cookies from a local browser.
 */
export async function isGeminiWebAvailable(
  chromeProfile?: string,
): Promise<CookieMap | null> {
  if (!isBrowserCookieAccessAllowed()) return null;

  const result = await getGoogleCookies({
    profile: chromeProfile,
    requiredCookies: ["__Secure-1PSID", "__Secure-1PSIDTS"],
  });

  if (!result) return null;
  return result.cookies;
}

/**
 * Query Gemini Web using extracted browser cookies.
 * Supports model selection, file uploads, and YouTube URL inclusion.
 */
export async function queryWithCookies(
  prompt: string,
  cookies: CookieMap,
  options?: GeminiWebOptions,
): Promise<string> {
  const model = options?.model ?? DEFAULT_MODEL;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;
  const files = options?.files;

  // Build full prompt
  let fullPrompt = prompt;
  if (options?.youtubeUrl) {
    fullPrompt += `\n\nYouTube URL: ${options.youtubeUrl}`;
  }

  // Try with requested model
  try {
    return await runGeminiWebOnce(fullPrompt, cookies, model, files, timeoutMs, signal);
  } catch (err) {
    // If model unavailable and not already using flash, retry with flash
    if (
      model !== "gemini-2.5-flash" &&
      err instanceof Error &&
      isModelUnavailableError(err)
    ) {
      return await runGeminiWebOnce(
        fullPrompt,
        cookies,
        "gemini-2.5-flash",
        files,
        timeoutMs,
        signal,
      );
    }
    throw err;
  }
}

function isModelUnavailableError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("model not available") ||
    msg.includes("model is not available") ||
    msg.includes("unsupported model")
  );
}

/**
 * Single attempt to query Gemini Web with a specific model.
 */
async function runGeminiWebOnce(
  prompt: string,
  cookies: CookieMap,
  model: string,
  files: string[] | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  // Create combined signal with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    // Build cookie header
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    // Fetch access token
    const { token, requestId } = await fetchAccessToken(cookieHeader, combinedSignal);

    // Upload files if provided
    let fileAttachments: unknown[] = [];
    if (files && files.length > 0) {
      fileAttachments = await uploadFiles(files, cookieHeader, combinedSignal);
    }

    // Build fReq payload
    const fReq = buildFReqPayload(prompt, token, requestId, fileAttachments);

    // Build request headers
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader,
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
    };

    // Add model header
    const modelHeader = MODEL_HEADERS[model];
    if (modelHeader) {
      headers["x-goog-ext-525001261-jspb"] = modelHeader;
    }

    // POST to BardChatUi
    const response = await fetch(
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?" +
        new URLSearchParams({
          bl: "boq_assistant-bard-web-server_20240101.00_p0",
          _reqid: requestId,
          rt: "c",
        }),
      {
        method: "POST",
        headers,
        body: `f.req=${encodeURIComponent(JSON.stringify([[[fReq]]]))}` +
          `&at=${encodeURIComponent(token)}`,
        signal: combinedSignal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Gemini Web request failed: ${response.status} ${response.statusText}`,
      );
    }

    const responseText = await response.text();
    return parseStreamingResponse(responseText);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the access token (SNlM0e or thykhd) from Gemini app page.
 */
async function fetchAccessToken(
  cookieHeader: string,
  signal: AbortSignal,
): Promise<{ token: string; requestId: string }> {
  const response = await fetch("https://gemini.google.com/app", {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Gemini access token: ${response.status}`);
  }

  const html = await response.text();

  // Try SNlM0e first
  const snlMatch = html.match(/"SNlM0e":"([^"]+)"/);
  if (snlMatch) {
    const requestId = String(Math.floor(100000 + Math.random() * 900000));
    return { token: snlMatch[1], requestId };
  }

  // Try thykhd
  const thyMatch = html.match(/"thykhd":"([^"]+)"/);
  if (thyMatch) {
    const requestId = String(Math.floor(100000 + Math.random() * 900000));
    return { token: thyMatch[1], requestId };
  }

  throw new Error(
    "Failed to extract Gemini access token (SNlM0e/thykhd not found). Cookies may be expired.",
  );
}

/**
 * Upload files to Google's content-push service.
 */
async function uploadFiles(
  files: string[],
  cookieHeader: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const attachments: unknown[] = [];

  for (const filePath of files) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mimeType = guessMimeType(fileName);

    const uploadResponse = await fetch(
      "https://content-push.googleapis.com/upload",
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": mimeType,
          "X-Goog-Upload-Header-Content-Length": String(fileBuffer.length),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "Push-ID": `pi-tools-${Date.now()}`,
        },
        body: fileBuffer,
        signal,
      },
    );

    if (uploadResponse.ok) {
      const uploadUrl = uploadResponse.headers.get("x-goog-upload-url");
      if (uploadUrl) {
        // Complete the upload
        const completeResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0",
          },
          body: fileBuffer,
          signal,
        });

        if (completeResponse.ok) {
          const result = await completeResponse.text();
          attachments.push({
            fileName,
            mimeType,
            uploadId: result.trim(),
          });
        }
      }
    }
  }

  return attachments;
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    txt: "text/plain",
    json: "application/json",
  };
  return mimeMap[ext ?? ""] ?? "application/octet-stream";
}

/**
 * Build the fReq payload for BardChatUi StreamGenerate.
 */
function buildFReqPayload(
  prompt: string,
  _token: string,
  _requestId: string,
  fileAttachments: unknown[],
): unknown[] {
  // Core request structure for BardChatUi
  const attachments =
    fileAttachments.length > 0
      ? fileAttachments.map((f) => {
          const file = f as { fileName: string; mimeType: string; uploadId: string };
          return [file.uploadId, file.mimeType, file.fileName];
        })
      : [];

  return [
    [prompt, 0, null, attachments.length > 0 ? [attachments] : null],
    null, // language
    null, // conversation id
    null, // response id
    null, // choice id
    null, // unknown
    [0], // session params
    null, // unknown
    null, // unknown
    null, // unknown
    null, // unknown
  ];
}

/**
 * Parse the streaming response from BardChatUi.
 * Response is a series of lines with length-prefixed JSON arrays.
 */
function parseStreamingResponse(responseText: string): string {
  const lines = responseText.split("\n");
  let fullText = "";

  for (const line of lines) {
    if (!line.trim()) continue;

    // Skip numeric length lines
    if (/^\d+$/.test(line.trim())) continue;

    try {
      const parsed = JSON.parse(line);
      if (!Array.isArray(parsed)) continue;

      // Navigate the nested response structure
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        if (entry[0] !== "wrb.fr") continue;

        const innerJson = entry[2];
        if (typeof innerJson !== "string") continue;

        try {
          const inner = JSON.parse(innerJson);
          if (!Array.isArray(inner)) continue;

          // Extract text from response candidates
          // Structure: inner[4][0][1][0] contains the text
          const candidates = inner[4];
          if (Array.isArray(candidates)) {
            for (const candidate of candidates) {
              if (Array.isArray(candidate) && candidate[1]) {
                const parts = candidate[1];
                if (Array.isArray(parts)) {
                  for (const part of parts) {
                    if (Array.isArray(part) && typeof part[0] === "string") {
                      fullText += part[0];
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Inner JSON parse failure — skip
        }
      }
    } catch {
      // Outer JSON parse failure — skip
    }
  }

  if (!fullText) {
    throw new Error("Failed to parse Gemini Web response: no text content found");
  }

  return fullText;
}
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/extract/gemini-web.ts
git commit -m "feat(extract): add gemini-web module with cookie-auth client and streaming parser"
```

---

## Task 4: Create `tests/extract/gemini-web.test.ts`

**Files:** `tests/extract/gemini-web.test.ts`

- [ ] **Step 1:** Create the test file

```typescript
// tests/extract/gemini-web.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

// Mock chrome-cookies module
vi.mock("../../src/extract/chrome-cookies.ts", () => ({
  getGoogleCookies: vi.fn(),
}));

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

    it("fetches access token from gemini.google.com/app", async () => {
      // Mock the app page with SNlM0e token
      fetchStub.addResponse("gemini.google.com/app", {
        body: `<html><script>data:"SNlM0e":"test-token-123"</script></html>`,
        headers: { "content-type": "text/html" },
      });

      // Mock the StreamGenerate response
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("Hello, this is Gemini!"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test prompt", mockCookies);
      expect(result).toBe("Hello, this is Gemini!");
    });

    it("includes YouTube URL in prompt when provided", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token-456"`,
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
    });

    it("sends model header for known models", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
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

      // Verify the model header was sent
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("BardChatUi"),
      );
      expect(streamCall).toBeDefined();
      expect(streamCall![1].headers["x-goog-ext-525001261-jspb"]).toBe(
        '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
      );
    });

    it("retries with gemini-2.5-flash on model unavailable error", async () => {
      let callCount = 0;
      fetchStub.restore();

      globalThis.fetch = vi.fn(async (url: string | URL) => {
        const urlStr = url instanceof URL ? url.href : url;

        if (urlStr.includes("gemini.google.com/app")) {
          return new Response(`"SNlM0e":"token"`, { status: 200 });
        }

        if (urlStr.includes("BardChatUi")) {
          callCount++;
          if (callCount === 1) {
            // First call: model unavailable
            return new Response("model not available", { status: 400 });
          }
          // Second call (fallback): success
          return new Response(buildMockStreamResponse("fallback response"), {
            status: 200,
          });
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test", mockCookies, {
        model: "gemini-3-pro",
      });
      expect(result).toBe("fallback response");
      expect(callCount).toBe(2);
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
      ).rejects.toThrow("Failed to extract Gemini access token");
    });

    it("throws on non-2xx response from StreamGenerate", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
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
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });

      // Simulate a slow response that exceeds timeout
      fetchStub.restore();
      globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url instanceof URL ? url.href : url;
        if (urlStr.includes("gemini.google.com/app")) {
          return new Response(`"SNlM0e":"token"`, { status: 200 });
        }
        // Wait longer than timeout
        await new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies, { timeoutMs: 50 }),
      ).rejects.toThrow();
    });

    it("uploads files when provided", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });

      fetchStub.addResponse("content-push.googleapis.com", {
        status: 200,
        body: "",
        headers: {
          "content-type": "text/plain",
          "x-goog-upload-url": "https://content-push.googleapis.com/upload/complete",
        },
      });

      fetchStub.addResponse("content-push.googleapis.com/upload/complete", {
        status: 200,
        body: "upload-id-123",
      });

      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("File analyzed"),
      });

      // Mock fs.readFileSync for the file
      const fsMock = await import("node:fs");
      vi.spyOn(fsMock, "readFileSync").mockReturnValue(
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
  });
});

/**
 * Build a mock streaming response in BardChatUi format.
 */
function buildMockStreamResponse(text: string): string {
  const innerPayload = JSON.stringify([
    null,
    null,
    null,
    null,
    [[[text]]],
  ]);
  const outerPayload = JSON.stringify([["wrb.fr", null, innerPayload]]);
  return `${outerPayload.length}\n${outerPayload}`;
}
```

- [ ] **Step 2:** Run tests

```bash
pnpm vitest run tests/extract/gemini-web.test.ts
```

- [ ] **Step 3:** Fix any test/implementation mismatches

If the streaming response parser doesn't correctly navigate the mock structure, adjust either the mock format or the parser until tests pass. The mock `buildMockStreamResponse` helper must match the parsing logic in `parseStreamingResponse`.

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

- [ ] **Step 4:** Fix any issues discovered in full suite run

Common issues to watch for:
- Import resolution: ensure `chrome-cookies.ts` and `gemini-web.ts` can be imported from other modules
- Type compatibility: `CookieMap` type must be consistent across modules
- No unused imports or variables (biome lint)

- [ ] **Step 5:** Create final commit if any fixes were needed

```bash
git add -A
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
| `src/extract/chrome-cookies.ts` | Cookie extraction from Chromium browsers (macOS/Linux), AES-128-CBC decryption |
| `src/extract/gemini-web.ts` | Gemini Web cookie-auth client (access token, file upload, streaming) |
| `tests/extract/chrome-cookies.test.ts` | Tests: decryption, DB query, platform-specific paths, error handling |
| `tests/extract/gemini-web.test.ts` | Tests: cookie check, token fetch, model headers, fallback, file upload, timeout |
