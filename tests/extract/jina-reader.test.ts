import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractViaJinaReader } from "../../src/extract/jina-reader.ts";
import { stubFetch } from "../helpers.ts";

describe("extractViaJinaReader", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("returns markdown from Jina Reader", async () => {
    fetchStub.addResponse("r.jina.ai", {
      body: "# Page Title\n\nRendered content from JS page. This article covers important topics and provides detailed information for readers who want to learn more about the subject.",
      headers: { "content-type": "text/plain" },
    });

    const result = await extractViaJinaReader("https://example.com");
    expect(result).not.toBeNull();
    expect(result).toContain("Rendered content");
  });

  it("returns null on failure", async () => {
    fetchStub.addResponse("r.jina.ai", { status: 500, body: "Error" });
    const result = await extractViaJinaReader("https://example.com");
    expect(result).toBeNull();
  });
});
