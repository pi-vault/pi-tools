import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ContentStore } from "../storage.ts";
import type { GuidanceOverride } from "../config.ts";

const WebReadParams = Type.Object({
  contentId: Type.String({
    description: "Content ID from a previous web_fetch or web_docs_fetch result",
  }),
});

export function createWebReadTool(
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebReadParams> {
  return {
    name: "web_read",
    label: "Web Read",
    description: "Retrieve previously fetched web content by its content ID without re-fetching.",
    promptSnippet:
      guidance?.promptSnippet ??
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
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_read"))} ${theme.fg("accent", `"${args.contentId}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
      if (options.expanded) {
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${raw.length} chars`));
      }
      return text;
    },
  };
}
