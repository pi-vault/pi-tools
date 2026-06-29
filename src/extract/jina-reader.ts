/**
 * Extracts rendered page content via the Jina Reader API (r.jina.ai).
 * Used as a fallback for JS-rendered pages that Readability and RSC can't parse.
 *
 * SECURITY: Jina Reader follows HTTP redirects without per-hop SSRF validation.
 * The initial URL is validated locally, but redirect chains may reach internal
 * resources. Acceptable risk since this is a fallback after local extraction fails.
 *
 * RATE LIMITS: Free tier allows ~500 RPM. Returns null on 429 or any failure.
 */
export async function extractViaJinaReader(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const readerUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(readerUrl, {
      headers: { Accept: "text/plain" },
      signal,
    });

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.trim().length < 100) return null;

    return text.trim();
  } catch {
    return null;
  }
}
