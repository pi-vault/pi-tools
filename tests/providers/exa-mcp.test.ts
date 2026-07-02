// tests/providers/exa-mcp.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaMcpProvider } from "../../src/providers/exa-mcp.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaMcpProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new ExaMcpProvider();
    expect(provider.name).toBe("exa-mcp");
    expect(provider.label).toBe("Exa MCP");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { title: "Exa Result", url: "https://exa.ai/page", text: "A snippet from Exa" },
                { title: "Second Result", url: "https://exa.ai/other", text: "Another snippet" },
              ]),
            },
          ],
        },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Exa Result",
      url: "https://exa.ai/page",
      snippet: "A snippet from Exa",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://exa.ai/other",
      snippet: "Another snippet",
    });
  });

  it("sends correct JSON-RPC request body", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "[]" }] },
      },
    });

    const provider = new ExaMcpProvider();
    await provider.search("my query", 3);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: { query: "my query", numResults: 3 },
      },
    });
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://exa.ai/${i}`,
      text: `Snippet ${i}`,
    }));
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify(manyResults) }] },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on HTTP error response", async () => {
    fetchStub.addResponse("mcp.exa.ai", { status: 500, body: "Server Error" });
    const provider = new ExaMcpProvider();
    await expect(provider.search("test", 5)).rejects.toThrow("Exa MCP error");
  });

  it("throws on JSON-RPC error response", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid request" },
      },
    });
    const provider = new ExaMcpProvider();
    await expect(provider.search("test", 5)).rejects.toThrow("Invalid request");
  });

  it("handles empty result content gracefully", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "[]" }] },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });
});
