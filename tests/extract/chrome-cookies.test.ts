// tests/extract/chrome-cookies.test.ts
import { pbkdf2Sync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock() calls are hoisted, so these run before any import.
// Both node:os and node:fs must be fully mocked -- ESM named exports
// from native modules are not spyable (namespace is non-configurable).

vi.mock("node:os", () => ({
  platform: vi.fn().mockReturnValue("darwin"),
  homedir: vi.fn().mockReturnValue("/Users/test"),
  tmpdir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  copyFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue("/tmp/pi-chrome-cookies-test"),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// node:sqlite mock.
// vi.mock factories are hoisted before variable declarations, so any variables
// referenced inside must also be hoisted via vi.hoisted().
const { mockAll, mockPrepare, mockClose } = vi.hoisted(() => {
  const mockAll = vi.fn().mockReturnValue([]);
  const mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
  const mockClose = vi.fn();
  return { mockAll, mockPrepare, mockClose };
});

vi.mock("node:sqlite", () => ({
  // Must use a regular function (not arrow) so it works as a `new` constructor.
  DatabaseSync: vi.fn(function () {
    return { prepare: mockPrepare, close: mockClose };
  }),
}));

/**
 * Build an AES-128-CBC encrypted cookie value matching Chrome's format.
 * Uses CJS require to avoid a top-level import of createCipheriv
 * (we already import node:crypto for pbkdf2Sync; require keeps the
 * cipher helper self-contained without adding an unused top-level import).
 */
function encryptCookieValue(
  plaintext: string,
  password: string,
  iterations: number,
  prefix: "v10" | "v11" = "v10",
): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
  const iv = Buffer.alloc(16, 0x20);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCipheriv } = require("node:crypto");
  const enc = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    Buffer.from(prefix),
    enc.update(plaintext, "utf8"),
    enc.final(),
  ]);
}

describe("chrome-cookies", () => {
  // Typed handles to the mocked module exports.
  let fsMock: {
    existsSync: ReturnType<typeof vi.fn>;
    copyFileSync: ReturnType<typeof vi.fn>;
    mkdtempSync: ReturnType<typeof vi.fn>;
    rmSync: ReturnType<typeof vi.fn>;
  };
  let osMock: {
    platform: ReturnType<typeof vi.fn>;
    homedir: ReturnType<typeof vi.fn>;
    tmpdir: ReturnType<typeof vi.fn>;
  };
  let execFileMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import mocked modules to get fresh references after resetModules.
    const fs = await import("node:fs");
    fsMock = fs as unknown as typeof fsMock;

    const os = await import("node:os");
    osMock = os as unknown as typeof osMock;

    const cp = await import("node:child_process");
    execFileMock = cp.execFile as unknown as ReturnType<typeof vi.fn>;

    // Reset all mocks to their starting state.
    vi.clearAllMocks();
    osMock.platform.mockReturnValue("darwin");
    osMock.homedir.mockReturnValue("/Users/test");
    osMock.tmpdir.mockReturnValue("/tmp");
    fsMock.existsSync.mockReturnValue(false);
    fsMock.mkdtempSync.mockReturnValue("/tmp/pi-chrome-cookies-test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getGoogleCookies", () => {
    it("returns null when no browser cookie DB exists", async () => {
      fsMock.existsSync.mockReturnValue(false);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      expect(await getGoogleCookies()).toBeNull();
    });

    it("returns null on unsupported platform", async () => {
      osMock.platform.mockReturnValue("win32");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      expect(await getGoogleCookies()).toBeNull();
    });

    it("returns plain-value cookies directly without decryption", async () => {
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "test-password\n");
      });

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ value: 20 }]; // readMetaVersion
        return [
          { name: "__Secure-1PSID", value: "plain-sid", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
          { name: "__Secure-1PSIDTS", value: "plain-sidts", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe("plain-sid");
      expect(result!.cookies["__Secure-1PSIDTS"]).toBe("plain-sidts");
    });

    it("returns null when required cookies are missing", async () => {
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "password\n");
      });

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ value: 20 }];
        return [
          { name: "__Secure-1PSID", value: "sid", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
          // __Secure-1PSIDTS is absent
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
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(new Error("Security: password not found"), "");
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      expect(await getGoogleCookies()).toBeNull();
    });

    it("uses 'peanuts' fallback on Linux when secret-tool fails", async () => {
      osMock.platform.mockReturnValue("linux");
      osMock.homedir.mockReturnValue("/home/test");
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(new Error("secret-tool not found"), "");
      });

      // Linux: 1 iteration, "peanuts" password
      const encrypted = encryptCookieValue("linux-session-id", "peanuts", 1, "v11");

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ value: 20 }]; // version < 24, no hash strip
        return [
          { name: "__Secure-1PSID", value: "", host_key: ".google.com", encrypted_value: encrypted },
          { name: "__Secure-1PSIDTS", value: "", host_key: ".google.com", encrypted_value: encrypted },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe("linux-session-id");
    });

    it("copies DB to temp before querying", async () => {
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "password\n");
      });

      mockAll.mockReturnValue([]);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      await getGoogleCookies();

      expect(fsMock.copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining("Cookies"),
        expect.stringContaining("/tmp/pi-chrome-cookies-test"),
      );
    });

    it("accepts custom profile name", async () => {
      fsMock.existsSync.mockReturnValue(false);

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      await getGoogleCookies({ profile: "Profile 1" });

      expect(fsMock.existsSync).toHaveBeenCalledWith(
        expect.stringContaining("Profile 1"),
      );
    });

    it("filters cookies through the allowlist", async () => {
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "password\n");
      });

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ value: 20 }];
        return [
          { name: "__Secure-1PSID", value: "sid-value", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
          { name: "UNKNOWN_COOKIE", value: "should-be-filtered", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
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

    it("decrypts v10-prefixed encrypted cookie (macOS, version < 24, no hash strip)", async () => {
      fsMock.existsSync.mockReturnValue(true);

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "my-secret\n");
      });

      const encrypted = encryptCookieValue("cookie-value-abc", "my-secret", 1003, "v10");

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ value: 20 }]; // version < 24 = no hash strip
        return [
          { name: "__Secure-1PSID", value: "", host_key: ".google.com", encrypted_value: encrypted },
          { name: "__Secure-1PSIDTS", value: "plain-ts", host_key: ".google.com", encrypted_value: new Uint8Array(0) },
        ];
      });

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      const result = await getGoogleCookies();

      expect(result).not.toBeNull();
      expect(result!.cookies["__Secure-1PSID"]).toBe("cookie-value-abc");
    });
  });
});
