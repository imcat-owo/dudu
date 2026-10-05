/**
 * B8: request/response diagnostic logs.
 *
 * Learned from Kelivo's log viewer: the app records what it actually
 * sent to the model (sanitized) and what came back, so debugging is
 * "look at the log" instead of "guess". For her it's invisible; for
 * the developer it's the first place to look when something breaks.
 *
 * Privacy: Authorization headers are ALWAYS redacted before storage.
 * Ring buffer (default 200 entries), auto-pruned by age (default 7d).
 * The viewer UI reads via listEntries(); entries never leave the device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const DIAG_KEY = "dudu.diagnostics.v1";
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 7 * 24 * 3600_000;

export interface DiagEntry {
  id: string;
  at: number;
  /** "chat" | "test" | "models" | "balance" | "oauth" | "speedtest" | "imageprobe" */
  kind: string;
  groupId: string;
  groupName: string;
  /** Sanitized request summary (no secrets). */
  request: {
    url: string;
    model: string;
    messageCount: number;
    bodyBytes: number;
    /** First 500 chars of the body with secrets redacted. */
    bodyPreview: string;
  };
  response: {
    ok: boolean;
    status?: number;
    ms: number;
    error?: string;
    /** First 300 chars of an error body. */
    bodyPreview?: string;
  };
}

const SENSITIVE_KEYS = ["authorization", "api-key", "x-api-key", "cookie", "set-cookie"];

/** Redact secret-looking values from a header map. Pure. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? "<redacted>" : v;
  }
  return out;
}

/** Redact "key":"..."-shaped secrets inside a JSON-ish preview. Pure. */
export function sanitizeBodyPreview(body: string): string {
  return body
    .replace(/("api_?key"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/g, "$1<redacted>")
    .slice(0, 500);
}

let memory: DiagEntry[] | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(DIAG_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) memory = parsed.filter((e) => typeof e?.id === "string");
    }
  } catch {
    // ignore
  }
  memory = memory ?? [];
  prune();
}

function prune(): void {
  if (!memory) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  memory = memory.filter((e) => e.at >= cutoff).slice(-MAX_ENTRIES);
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(DIAG_KEY, JSON.stringify(memory ?? []));
  } catch {
    // ignore
  }
}

export async function logDiag(entry: Omit<DiagEntry, "id">): Promise<void> {
  await ensureLoaded();
  memory = [...(memory ?? []), { ...entry, id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` }];
  prune();
  await persist();
}

export async function listDiagEntries(): Promise<DiagEntry[]> {
  await ensureLoaded();
  return [...(memory ?? [])].reverse();
}

export async function clearDiagEntries(): Promise<void> {
  memory = [];
  await persist();
}

/** Test hook. */
export async function __resetDiagForTests(): Promise<void> {
  memory = [];
  loaded = true;
}
