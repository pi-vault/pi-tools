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
