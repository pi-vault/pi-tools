import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";

const WebReadParams = Type.Object({
  contentId: Type.String({ description: "Content ID from a previous web_fetch or web_search result" }),
});

export function createWebReadTool(
  store: ContentStore,
): ToolDefinition<typeof WebReadParams> {
  return {
    name: "web_read",
    label: "Web Read",
    description:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    promptSnippet:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    parameters: WebReadParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const content = store.get(params.contentId);
      if (!content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Content not found: ${params.contentId}. The content ID may have expired or is from a different session.`,
            },
          ],
          details: undefined,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `# ${content.title ?? content.url}\n\nSource: ${content.url}\nChars: ${content.chars}\n\n${content.text}`,
          },
        ],
        details: undefined,
      };
    },
  };
}
