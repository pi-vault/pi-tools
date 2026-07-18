import type { ProviderMeta } from "./types.ts";
import { providerMeta as context7 } from "./context7.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { httpProviders } from "./http-providers.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as ollama } from "./ollama.ts";
import { providerMeta as openaiCodex } from "./openai-codex.ts";
import { providerMeta as openaiWebSearch } from "./openai-web-search.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as sofya } from "./sofya.ts";
import { providerMeta as tavily } from "./tavily.ts";

export const allProviders: ProviderMeta[] = [
  ...httpProviders,
  context7,
  duckduckgo,
  exa,
  firecrawl,
  jina,
  ollama,
  openaiCodex,
  openaiWebSearch,
  parallel,
  searxng,
  serper,
  sofya,
  tavily,
];
