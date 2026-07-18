import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("extension loading", () => {
  it("loads through Pi's real extension loader", async () => {
    const agentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const loaderUrl = new URL("./core/extensions/loader.js", agentEntry);
    const { loadExtensions } = await import(loaderUrl.href);
    const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const cwd = fileURLToPath(new URL("..", import.meta.url));

    const result = await loadExtensions([extensionPath], cwd);

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
  });
});
