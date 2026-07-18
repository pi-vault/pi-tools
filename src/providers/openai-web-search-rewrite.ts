// src/providers/openai-web-search-rewrite.ts

/**
 * Layer 1: Transparent payload rewrite for OpenAI web search.
 *
 * When running on OpenAI/Codex models, rewrites the `web_search` function tool
 * definition to OpenAI's native `{ type: "web_search" }` format. The model then
 * uses its built-in web search — no API call from us, no quota cost.
 */

export function isOpenAiModel(
  model: { provider?: string } | undefined,
): boolean {
  if (!model) return false;
  const provider = (model.provider ?? "").toLowerCase();
  return provider === "openai" || provider.startsWith("openai-");
}

export function rewriteOpenAiWebSearchTool<T extends { tools?: unknown[] }>(
  payload: T,
  options?: { externalWebAccess?: boolean },
): { payload: T; rewritten: string[] } {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    return { payload, rewritten: [] };
  }

  const externalWebAccess = options?.externalWebAccess ?? true;
  const rewritten: string[] = [];

  const newTools = payload.tools.map((tool: unknown) => {
    if (!tool || typeof tool !== "object") return tool;
    const t = tool as { type: string; function?: { name?: string } };
    if (t.type === "function" && t.function?.name === "web_search") {
      rewritten.push("web_search");
      return { type: "web_search", external_web_access: externalWebAccess };
    }
    return tool;
  });

  return {
    payload: { ...payload, tools: newTools },
    rewritten,
  };
}
