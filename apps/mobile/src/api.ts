import { t } from "./i18n";
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://muse.paw.os.kg").replace(
  /\/$/,
  "",
);

/**
 * Round-3 code P3-2: legacy cloud path budget — a hung session call must
 * not hang login/workspace-open with no feedback.
 */
const LEGACY_API_TIMEOUT_MS = 20_000;

function legacySignal(timeoutMs: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), timeoutMs);
  return { signal: c.signal, done: () => clearTimeout(tm) };
}

function legacyFailed(e: unknown, status?: number): Error {
  if ((e as { name?: string } | null)?.name === "AbortError") {
    return new Error(t("api.requestFailed", { status: "timeout" }));
  }
  if (status !== undefined) return new Error(t("api.requestFailed", { status }));
  return new Error(`${e instanceof Error ? e.message : String(e)}`);
}

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(
    path: string,
    body?: unknown,
    method?: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? LEGACY_API_TIMEOUT_MS;
    const s = legacySignal(timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined || body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal: s.signal,
      });
    } catch (e) {
      s.done();
      throw legacyFailed(e);
    }
    const payload = await response.json();
    s.done();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : t("api.requestFailed", { status: response.status }),
      );
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
}

export async function createSession(
  accessKey?: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ token: string; mode: "sample" | "live" }> {
  const s = legacySignal(opts.timeoutMs ?? LEGACY_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey }),
      signal: s.signal,
    });
  } catch (e) {
    s.done();
    throw legacyFailed(e);
  }
  const payload = await response.json();
  s.done();
  if (!response.ok) throw new Error(payload.error || t("api.workspaceOpenFailed"));
  return payload;
}
