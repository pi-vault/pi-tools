import { describe, expect, it } from "vitest";
import {
  parseIPv6,
  ipv4ToBytes,
  ipv6GroupsToBytes,
  ipToBytes,
  parseCidr,
  parseAllowRanges,
  bytesMatchPrefix,
  isInAllowedRange,
} from "../../src/utils/ssrf.ts";

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

  it("handles partial-byte prefix (/12)", () => {
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
