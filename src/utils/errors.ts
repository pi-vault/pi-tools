const SECRETS_PATTERN =
  /(bearer|token|api[-_]?key|authorization|secret|password)\s*[:=]?\s*[\w./-]{8,}/gi;
const MAX_LENGTH = 300;

export function sanitizeError(error: unknown): string {
  let msg: string;
  if (error === null || error === undefined) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "string") {
    msg = error;
  } else {
    msg = String(error);
  }

  msg = msg.replace(SECRETS_PATTERN, "[redacted]");

  if (msg.length > MAX_LENGTH) {
    msg = msg.slice(0, MAX_LENGTH);
  }

  return msg;
}

export class AggregateProviderError extends Error {
  readonly errors: Array<{ provider: string; error: string }>;

  constructor(context: string, errors: Array<{ provider: string; error: string }>) {
    const lines = errors.map((e) => `- ${e.provider}: ${sanitizeError(e.error)}`);
    super(`All ${context} providers failed:\n${lines.join("\n")}`);
    this.name = "AggregateProviderError";
    this.errors = errors;
  }
}
