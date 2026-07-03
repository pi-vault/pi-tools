export function truncateContent(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const notice = `\n\n[truncated] showing ${limit} of ${text.length} chars`;
  // Assumes notice.length < limit. With limit=15,000, notice is ~50 chars.
  return text.slice(0, limit - notice.length) + notice;
}
