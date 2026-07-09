import { describe, expect, it } from "vitest";
import { SSRFError, validateUrl } from "../../src/utils/ssrf.ts";


describe("validateUrl", () => {
  it("allows valid HTTPS URLs", () => {
    expect(() => validateUrl("https://example.com")).not.toThrow();
    expect(() => validateUrl("https://docs.rs/tokio")).not.toThrow();
  });

  it("allows valid HTTP URLs", () => {
    expect(() => validateUrl("http://example.com")).not.toThrow();
  });

  it("blocks non-http(s) protocols", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow(SSRFError);
    expect(() => validateUrl("file:///etc/passwd")).toThrow(SSRFError);
    expect(() => validateUrl("javascript:alert(1)")).toThrow(SSRFError);
  });

  it("blocks loopback addresses", () => {
    expect(() => validateUrl("http://127.0.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://127.0.0.1:8080/path")).toThrow(SSRFError);
    expect(() => validateUrl("http://[::1]")).toThrow(SSRFError);
    expect(() => validateUrl("http://localhost")).toThrow(SSRFError);
    expect(() => validateUrl("http://test.localhost")).toThrow(SSRFError);
  });

  it("blocks RFC 1918 private ranges", () => {
    expect(() => validateUrl("http://10.0.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://172.16.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://192.168.1.1")).toThrow(SSRFError);
  });

  it("blocks link-local addresses", () => {
    expect(() => validateUrl("http://169.254.1.1")).toThrow(SSRFError);
  });

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

  it("blocks cloud metadata endpoint", () => {
    expect(() => validateUrl("http://169.254.169.254")).toThrow(SSRFError);
    expect(() =>
      validateUrl("http://169.254.169.254/latest/meta-data"),
    ).toThrow(SSRFError);
  });

  it("blocks URLs with credentials", () => {
    expect(() => validateUrl("http://user:pass@example.com")).toThrow(
      SSRFError,
    );
    expect(() => validateUrl("http://admin@example.com")).toThrow(SSRFError);
  });

  it("blocks invalid URLs", () => {
    expect(() => validateUrl("not-a-url")).toThrow(SSRFError);
    expect(() => validateUrl("")).toThrow(SSRFError);
  });
});

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

describe("validateUrl with allowedBaseUrls", () => {
  it("allows localhost URL when it matches an allowed base URL", () => {
    const result = validateUrl(
      "http://localhost:8080/search?q=test&format=json",
      { allowedBaseUrls: ["http://localhost:8080"] },
    );
    expect(result.hostname).toBe("localhost");
  });

  it("allows private IP URL when it matches an allowed base URL", () => {
    const result = validateUrl(
      "http://192.168.1.100:8080/search?q=hello",
      { allowedBaseUrls: ["http://192.168.1.100:8080"] },
    );
    expect(result.hostname).toBe("192.168.1.100");
  });

  it("still blocks localhost without allowedBaseUrls", () => {
    expect(() => validateUrl("http://localhost:8080/search")).toThrow(
      "Blocked hostname",
    );
  });

  it("blocks localhost when URL does not match any allowed base URL", () => {
    expect(() =>
      validateUrl("http://localhost:9090/search", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");
  });

  it("requires the allowed URL to be a prefix match (scheme + host + port)", () => {
    // Port mismatch
    expect(() =>
      validateUrl("http://localhost:3000/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");

    // Scheme mismatch
    expect(() =>
      validateUrl("https://localhost:8080/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");
  });

  it("does not bypass protocol or credential checks for allowed URLs", () => {
    expect(() =>
      validateUrl("ftp://localhost:8080/path", {
        allowedBaseUrls: ["ftp://localhost:8080"],
      }),
    ).toThrow("Blocked protocol");

    expect(() =>
      validateUrl("http://user:pass@localhost:8080/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("credentials");
  });
});
