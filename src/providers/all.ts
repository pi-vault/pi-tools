import type { ProviderMeta } from "./types.ts";
import { providerMeta as brave } from "./brave.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as exaMcp } from "./exa-mcp.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as openaiNative } from "./openai-native.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as perplexity } from "./perplexity.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as tavily } from "./tavily.ts";
import { providerMeta as websearchapi } from "./websearchapi.ts";

export const allProviders: ProviderMeta[] = [
  brave,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  openaiNative,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
