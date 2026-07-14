// src/extract/gemini-web.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig } from "../config.ts";
import type { CookieMap } from "./chrome-cookies.ts";
import { getGoogleCookies } from "./chrome-cookies.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 10;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const MODEL_HEADERS: Record<string, string> = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiWebOptions {
  youtubeUrl?: string;
  files?: string[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface GeminiWebResult {
  text: string;
  errorCode?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function isBrowserCookieAccessAllowed(): boolean {
  if (process.env.PI_ALLOW_BROWSER_COOKIES === "1") return true;
  try {
    return loadConfig().gemini?.allowBrowserCookies === true;
  } catch {
    return false;
  }
}

/**
 * Check if Gemini Web is available by verifying cookie access permission
 * and extracting valid Google cookies from a local browser.
 * Returns the cookie map if available, null otherwise.
 */
export async function isGeminiWebAvailable(
  chromeProfile?: string,
): Promise<CookieMap | null> {
  if (!isBrowserCookieAccessAllowed()) return null;

  let profile = chromeProfile?.trim() || undefined;
  if (!profile) {
    try {
      profile = loadConfig().gemini?.chromeProfile?.trim() || undefined;
    } catch {
      // config unavailable
    }
  }

  const result = await getGoogleCookies({
    profile,
    requiredCookies: REQUIRED_COOKIES,
  });

  if (!result) return null;
  return result.cookies;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query Gemini Web using extracted browser cookies.
 * Supports model selection, file uploads, and YouTube URL inclusion.
 * Falls back to gemini-2.5-flash if the requested model returns error code 1052.
 */
export async function queryWithCookies(
  prompt: string,
  cookieMap: CookieMap,
  options: GeminiWebOptions = {},
): Promise<string> {
  const model =
    options.model && MODEL_HEADERS[options.model]
      ? options.model
      : DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let fullPrompt = prompt;
  if (options.youtubeUrl) {
    fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
  }

  const result = await runGeminiWebOnce(
    fullPrompt,
    cookieMap,
    model,
    options.files,
    timeoutMs,
    options.signal,
  );

  // Error code 1052 = model unavailable; retry with flash
  if (result.errorCode === 1052 && model !== DEFAULT_MODEL) {
    const fallback = await runGeminiWebOnce(
      fullPrompt,
      cookieMap,
      DEFAULT_MODEL,
      options.files,
      timeoutMs,
      options.signal,
    );
    if (fallback.errorMessage) throw new Error(fallback.errorMessage);
    if (!fallback.text)
      throw new Error("Gemini Web returned empty response (fallback model)");
    return fallback.text;
  }

  if (result.errorMessage) throw new Error(result.errorMessage);
  if (!result.text) throw new Error("Gemini Web returned empty response");
  return result.text;
}

// ---------------------------------------------------------------------------
// Internal request pipeline
// ---------------------------------------------------------------------------

/**
 * Single attempt to query Gemini Web with a specific model.
 */
async function runGeminiWebOnce(
  prompt: string,
  cookieMap: CookieMap,
  model: string,
  files: string[] | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GeminiWebResult> {
  const effectiveSignal = withTimeout(signal, timeoutMs);
  const cookieHeader = buildCookieHeader(cookieMap);
  const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);

  const uploaded: Array<{ id: string; name: string }> = [];
  if (files) {
    for (const filePath of files) {
      uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
    }
  }

  const fReq = buildFReqPayload(prompt, uploaded);
  const params = new URLSearchParams();
  params.set("at", accessToken);
  params.set("f.req", fReq);

  const res = await fetch(GEMINI_STREAM_GENERATE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      host: "gemini.google.com",
      origin: "https://gemini.google.com",
      referer: "https://gemini.google.com/",
      "x-same-domain": "1",
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
      [MODEL_HEADER_NAME]: MODEL_HEADERS[model] ?? MODEL_HEADERS[DEFAULT_MODEL],
    },
    body: params.toString(),
    signal: effectiveSignal,
  });

  const rawText = await res.text();

  if (!res.ok) {
    return {
      text: "",
      errorMessage: `Gemini Web request failed: ${res.status}`,
    };
  }

  try {
    return parseStreamGenerateResponse(rawText);
  } catch (err) {
    let errorCode: number | undefined;
    try {
      const json = JSON.parse(trimJsonEnvelope(rawText));
      errorCode = extractErrorCode(json);
    } catch {
      // can't parse error code from malformed response
    }
    return {
      text: "",
      errorCode,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Token fetch with cookie-aware redirect following
// ---------------------------------------------------------------------------

/**
 * Fetch the access token (SNlM0e or thykhd) from the Gemini app page.
 * Manually follows redirects to preserve cookies across auth bounces.
 */
async function fetchAccessToken(
  cookieHeader: string,
  signal: AbortSignal,
): Promise<string> {
  const html = await fetchWithCookieRedirects(
    GEMINI_APP_URL,
    cookieHeader,
    MAX_REDIRECTS,
    signal,
  );

  for (const key of ["SNlM0e", "thykhd"]) {
    const match = html.match(new RegExp(`"${key}":"(.*?)"`));
    if (match?.[1]) return match[1];
  }

  throw new Error(
    "Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in a supported Chromium-based browser.",
  );
}

/**
 * Fetch a URL with manual redirect following that preserves cookies.
 * Native fetch's automatic redirect drops custom Cookie headers.
 */
async function fetchWithCookieRedirects(
  url: string,
  cookieHeader: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<string> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, {
      headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
    }
    return await res.text();
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to Google's content-push service using multipart/form-data.
 */
async function uploadFile(
  filePath: string,
  cookieHeader: string,
  signal: AbortSignal,
): Promise<{ id: string; name: string }> {
  const data = readFileSync(filePath);
  const fileName = basename(filePath);
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, "utf-8"),
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    Buffer.from(footer, "utf-8"),
  ]);

  const res = await fetch(GEMINI_UPLOAD_URL, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "push-id": GEMINI_UPLOAD_PUSH_ID,
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
    },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `File upload failed: ${res.status} (${text.slice(0, 200)})`,
    );
  }

  return { id: await res.text(), name: fileName };
}

// ---------------------------------------------------------------------------
// Request payload
// ---------------------------------------------------------------------------

/**
 * Build the fReq payload for BardChatUi StreamGenerate.
 * Format: JSON.stringify([null, JSON.stringify(innerList)])
 */
function buildFReqPayload(
  prompt: string,
  uploaded: Array<{ id: string; name: string }>,
): string {
  const promptPayload =
    uploaded.length > 0
      ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])]
      : [prompt];
  const innerList = [promptPayload, null, null];
  return JSON.stringify([null, JSON.stringify(innerList)]);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the streaming response from BardChatUi.
 */
function parseStreamGenerateResponse(rawText: string): GeminiWebResult {
  const responseJson = JSON.parse(trimJsonEnvelope(rawText));
  const errorCode = extractErrorCode(responseJson);

  const parts = Array.isArray(responseJson) ? responseJson : [];
  let firstCandidateSeen: unknown;
  let latestNonEmptyText = "";

  for (let i = 0; i < parts.length; i++) {
    const partBody = getNestedValue(parts[i], [2]);
    if (!partBody || typeof partBody !== "string") continue;
    try {
      const parsed = JSON.parse(partBody);
      const candidateList = getNestedValue(parsed, [4]);
      if (!Array.isArray(candidateList) || candidateList.length === 0) continue;

      const firstCandidate = (candidateList as unknown[])[0];
      if (firstCandidateSeen === undefined) firstCandidateSeen = firstCandidate;

      const text = extractCandidateText(firstCandidate);
      if (text.length > 0) latestNonEmptyText = text;
    } catch {
      // inner JSON parse failure -- skip this part
    }
  }

  const text =
    latestNonEmptyText.length > 0
      ? latestNonEmptyText
      : extractCandidateText(firstCandidateSeen);

  return { text, errorCode };
}

/**
 * Extract the main text from a candidate response entry.
 * Falls back to index [22][0] if the primary text looks like a googleusercontent card URL.
 */
function extractCandidateText(candidate: unknown): string {
  const textRaw = getNestedValue(candidate, [1, 0]);
  let text = typeof textRaw === "string" ? textRaw : "";

  if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
    const alt = getNestedValue(candidate, [22, 0]);
    if (typeof alt === "string" && alt.length > 0) text = alt;
  }

  return text;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function buildCookieHeader(cookieMap: CookieMap): string {
  return Object.entries(cookieMap)
    .filter(([, v]) => v.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getNestedValue(value: unknown, pathParts: number[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (current == null) return undefined;
    if (!Array.isArray(current)) return undefined;
    current = (current as unknown[])[part];
  }
  return current;
}

/**
 * Find the outermost JSON array in the response text.
 */
function trimJsonEnvelope(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON payload.");
  }
  return text.slice(start, end + 1);
}

function extractErrorCode(responseJson: unknown): number | undefined {
  const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
  return typeof code === "number" && code >= 0 ? code : undefined;
}
