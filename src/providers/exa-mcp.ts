// src/providers/exa-mcp.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface ExaMcpResult {
  title: string;
  url: string;
  text?: string;
}

export class ExaMcpProvider implements SearchProvider {
  readonly name = "exa-mcp";
  readonly label = "Exa MCP";

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: { query, numResults: maxResults },
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Exa MCP error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as JsonRpcResponse;

    if (data.error) {
      throw new Error(
        `Exa MCP JSON-RPC error: ${data.error.message}`,
      );
    }

    const textContent = data.result?.content?.[0]?.text;
    if (!textContent) return [];

    let parsed: ExaMcpResult[];
    try {
      parsed = JSON.parse(textContent) as ExaMcpResult[];
    } catch {
      throw new Error("Exa MCP error: invalid response content");
    }
    return parsed.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
    }));
  }
}
