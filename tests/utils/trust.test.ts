import { afterEach, describe, expect, it } from "vitest";
import { recordProjectTrust, isProjectTrustedCached, _resetTrustRegistry } from "../../src/utils/trust.ts";

describe("trust registry", () => {
  afterEach(() => {
    _resetTrustRegistry();
  });

  it("records trusted project and retrieves it", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => true });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(true);
  });

  it("records untrusted project and retrieves it", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => false });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);
  });

  it("defaults to untrusted when project has not been recorded", () => {
    expect(isProjectTrustedCached("/home/user/unknown-project")).toBe(false);
  });

  it("does nothing when cwd is undefined", () => {
    recordProjectTrust({ cwd: undefined, isProjectTrusted: () => true });
    // No crash, no entry recorded
    expect(isProjectTrustedCached("undefined")).toBe(false);
  });

  it("does nothing when isProjectTrusted is missing", () => {
    recordProjectTrust({ cwd: "/home/user/my-project" });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);
  });

  it("updates trust status on re-record", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => false });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);

    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => true });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(true);
  });

  it("tracks multiple projects independently", () => {
    recordProjectTrust({ cwd: "/project-a", isProjectTrusted: () => true });
    recordProjectTrust({ cwd: "/project-b", isProjectTrusted: () => false });

    expect(isProjectTrustedCached("/project-a")).toBe(true);
    expect(isProjectTrustedCached("/project-b")).toBe(false);
  });

  it("defaults to untrusted when no trust recorded (cache miss)", () => {
    expect(isProjectTrustedCached("/some/random/dir")).toBe(false);
  });
});
