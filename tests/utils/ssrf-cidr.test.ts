import { describe, expect, it } from "vitest";
import {
  parseIPv6,
  ipv4ToBytes,
  ipv6GroupsToBytes,
  ipToBytes,
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
