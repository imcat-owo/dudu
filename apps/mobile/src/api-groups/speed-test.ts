/**
 * B16: model speed-test — try a model before committing to it.
 *
 * Learned from OpenMinis: the model picker sends a tiny probe and
 * reports latency, so she can feel which model is alive before
 * switching the whole dialog to it. No dialog needed.
 */

import { type ApiGroup, normalizeBaseUrl } from "./types";
import { resolveAuth } from "./direct-transport";

export interface SpeedTestResult {
  ok: boolean;
  /** ms to first byte. */
  ttfbMs: number | null;
  /** ms to full probe completion. */
  totalMs: number | null;
  /** First few chars of the reply (proof of life). */
  preview: string;
  error: string | null;
}

const SPEED_TEST_TIMEOUT_MS = 30_000;

/**
 * Send a minimal probe ("ping") to a model and measure it.
 * Never throws — the result carries the error.
 */
export async function speedTestModel(
  group: ApiGroup,
  modelOverride?: string,
): Promise<SpeedTestResult> {
  const started = Date.now();
  let ttfbMs: number | null = null;
  const fail = (error: string): SpeedTestResult => ({
    ok: false,
    ttfbMs,
    totalMs: Date.now() - started,
    preview: "",
    error,
  });
  let auth: { headers: Record<string, string> };
  try {
    auth = await resolveAuth(group);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SPEED_TEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeBaseUrl(group.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        model: modelOverride ?? group.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    ttfbMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const p = JSON.parse(text) as { error?: { message?: string } | string };
        if (typeof p.error === "string") detail = p.error;
        else if (p.error?.message) detail = p.error.message;
      } catch {
        // keep raw
      }
      return fail(`HTTP ${res.status}: ${detail}`);
    }
    let preview = "";
    try {
      const p = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
      const c = p.choices?.[0]?.message?.content;
      if (typeof c === "string") preview = c.slice(0, 60);
    } catch {
      // ignore
    }
    return { ok: true, ttfbMs, totalMs: Date.now() - started, preview, error: null };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return fail("timed out (30s)");
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
