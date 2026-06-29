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
