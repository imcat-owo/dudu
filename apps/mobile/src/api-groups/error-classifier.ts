/**
 * Error classification for intelligent API auto-adaptation.
 *
 * When a chat request fails, we need to know WHY so we can adapt:
 * disable tools, disable thinking, or compact the context — instead of
 * just showing "failed" and making her tweak settings by hand.
 *
 * Pure module: no React Native imports, fully testable.
 */

export type ErrorClass =
  | "tools_unsupported"
  | "thinking_unsupported"
  | "context_too_long"
  | "auth_error"
  | "rate_limit"
  | "network_error"
  | "unknown";

/**
 * Classify a request failure. Inspects the error message (and HTTP status
 * when available) for the shapes used by OpenAI-compatible endpoints,
 * Anthropic, and Gemini — including the reverse proxies she uses, which
 * often reword the underlying error.
 *
 * Never throws. Unknown shapes → "unknown" (we don't guess, we just
 * don't adapt).
 */
export function classifyError(err: unknown): ErrorClass {
  const msg = errorText(err).toLowerCase();
  const status = httpStatus(err);

  // Auth first — a 401/403 is never a capability problem.
  if (
    status === 401 ||
    status === 403 ||
    /\b(unauthorized|invalid api key|incorrect api key|authentication|invalid_api_key|bearer)\b/.test(
      msg,
    )
  ) {
    return "auth_error";
  }

  // Rate limits — retry later, don't touch the config.
  if (status === 429 || /\b(rate.?limit|too many requests|quota.?exceeded|429)\b/.test(msg)) {
    return "rate_limit";
  }

  // Network-level failures — nothing wrong with the config.
  if (
    /\b(network error|fetch failed|econnrefused|etimedout|enotfound|socket hang up|timed out|aborted|stream stalled)\b/.test(
      msg,
    ) ||
    status === 0
  ) {
    return "network_error";
  }

  // Context too long — the shapes differ per provider.
  if (
    /\b(context.?length|context.?window|maximum context|token.?limit|too many tokens|input.?too.?long|prompt.?too.?long|context_length_exceeded|invalid_request_error.{0,40}context)\b/.test(
      msg,
    )
  ) {
    return "context_too_long";
  }

  // Tools unsupported — the model/proxy rejects function calling.
  if (
    /\b(tools? (are |is |were |was )?(not|aren.?t|isn.?t) (supported|available)|function.?calling (is |are )?(not|isn.?t).{0,20}(supported|available)|unsupported (parameter|field).{0,30}tool|tool_choice.{0,30}(not|unsupported)|does not support (tools?|function calling)|tools? are not enabled)\b/.test(
      msg,
    )
  ) {
    return "tools_unsupported";
  }

  // Thinking unsupported — the model/proxy rejects reasoning params.
  if (
    /\b(reasoning.{0,20}(not|unsupported)|thinking.{0,20}(not|unsupported)|unsupported.{0,30}reasoning|reasoning_content.{0,30}(not|unsupported))\b/.test(
      msg,
    )
  ) {
    return "thinking_unsupported";
  }

  return "unknown";
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err ?? "");
}

function httpStatus(err: unknown): number | null {
  // GroupError messages look like "HTTP 400: ..." — fish the status out.
  const m = /HTTP\s+(\d{3})/i.exec(errorText(err));
  return m ? Number(m[1]) : null;
}
