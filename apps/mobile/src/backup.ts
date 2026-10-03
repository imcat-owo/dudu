/**
 * Backup & restore — pure logic, aligned with Kelivo.
 *
 * One-tap export produces a single versioned JSON file:
 *   { "kind": "dudu-backup", "version": 1, "exportedAt": ..., ... }
 *
 * Included: chat threads, API group configs (WITHOUT keys), theme bundles,
 * voice/vision configs (WITHOUT keys), permission + AI-auth preferences,
 * app settings (font, font size, chat mode).
 *
 * NEVER included:
 * - Secrets (API keys, custom TTS/STT keys, extra headers). They live in
 *   SecureStore and are stripped on export. Restore warns the user to
 *   re-enter them. We do NOT invent homebrew encryption.
 * - Incognito content. It is never persisted to storage, so it cannot
 *   end up in a backup (there is a test for this).
 * - Cached audio/images (regenerable, bulky).
 *
 * Restore validates the whole file BEFORE writing anything. Corrupt files
 * fail with a human-readable error code — never half-apply.
 */

export const BACKUP_KIND = "dudu-backup";
export const BACKUP_VERSION = 1;

/** Minimal storage surface. AsyncStorage in production, fakes in tests. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export interface SecureKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// Storage keys mirrored from their source modules (single place for backup).
const CHAT_PREFIX = "dudu.local-chat.";
const CHAT_SUFFIX = ".v1";
const GROUPS_KEY = "dudu.api-groups.v1";
const ACTIVE_ID_KEY = "dudu.api-groups.active.v1";
const CHAT_MODE_KEY = "dudu.settings.chatMode.v1";
const THEME_BUNDLE_KEY = "dudu.theme.bundle.v1";
const THEME_HISTORY_KEY = "dudu.theme.history.v1";
const CUSTOMS_KEY = "dudu.theme.customPresets.v1";
const FONT_KEY = "dudu.font.v1";
const FONT_SIZE_KEY = "dudu.settings.fontSize.v1";
const TTS_KEY = "dudu.tts.v1";
const STT_KEY = "dudu.stt.v1";
const VOICE_SETTINGS_KEY = "dudu.voice-settings.v1";
const AI_AUTH_KEY = "dudu.aiAuth.v1";
const LAST_BACKUP_KEY = "dudu.backup.lastAt.v1";

const PLAIN_KEYS = [
  ACTIVE_ID_KEY,
  CHAT_MODE_KEY,
  THEME_BUNDLE_KEY,
  THEME_HISTORY_KEY,
  CUSTOMS_KEY,
  FONT_KEY,
  FONT_SIZE_KEY,
  VOICE_SETTINGS_KEY,
];

// TTS/STT configs live in SecureStore in production (voice/store.ts) —
// never in plain AsyncStorage. They are read/written via the secure backend.
const SECURE_VOICE_KEYS = [TTS_KEY, STT_KEY] as const;

export interface SecretsExcluded {
  apiKeys: number;
  ttsKeys: number;
  sttKeys: number;
}

export interface BackupChatThread {
  id: string;
  messages: unknown[];
}

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  secretsExcluded: SecretsExcluded;
  chat: { threads: BackupChatThread[] };
  apiGroups: unknown[];
  plain: Record<string, unknown>;
  aiAuth: Record<string, unknown>;
}

export type BackupParseError =
  | "empty"
  | "not-json"
  | "bad-kind"
  | "unsupported-version"
  | "invalid-shape";

export type ParseBackupResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; code: BackupParseError; detail?: string };

function stripApiGroup(g: unknown): { group: unknown; hadKey: boolean } {
  if (typeof g !== "object" || g === null) return { group: g, hadKey: false };
  const o = g as Record<string, unknown>;
  const hadKey = typeof o.apiKey === "string" && o.apiKey.length > 0;
  const { apiKey: _ak, headers: _h, ...rest } = o;
  return { group: sanitizeConfigUrls(rest), hadKey };
}

function stripVoiceConfig(
  cfg: unknown,
  keyField: "customKey",
): { config: unknown; hadKey: boolean } {
  if (typeof cfg !== "object" || cfg === null) return { config: cfg, hadKey: false };
  const o = cfg as Record<string, unknown>;
  const hadKey = typeof o[keyField] === "string" && (o[keyField] as string).length > 0;
  const { [keyField]: _k, ...rest } = o;
  return { config: rest, hadKey };
}

async function readJson(kv: KeyValueStore, key: string): Promise<unknown> {
  try {
    const raw = await kv.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readSecureJson(secure: SecureKV, key: string): Promise<unknown> {
  try {
    const raw = await secure.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Strip query-string secrets from a URL (e.g. a key pasted as
 * `?key=sk-xxx` into a URL field). Non-secret params are kept;
 * non-URL strings pass through untouched.
 */
const SECRET_QUERY_PARAM =
  /^(key|api_key|apikey|token|access_token|secret|password|passwd|auth|authorization)$/i;

export function sanitizeUrl(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const base = url.slice(0, q);
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((pair) => {
      const name = pair.split("=")[0] ?? "";
      try {
        return !SECRET_QUERY_PARAM.test(decodeURIComponent(name));
      } catch {
        return !SECRET_QUERY_PARAM.test(name);
      }
    });
  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

/** Sanitize URL-ish fields on a config object (baseUrl/customUrl/url). */
function sanitizeConfigUrls(cfg: unknown): unknown {
  if (typeof cfg !== "object" || cfg === null) return cfg;
  const o = { ...(cfg as Record<string, unknown>) };
  for (const f of ["baseUrl", "customUrl", "url"]) {
    if (typeof o[f] === "string") o[f] = sanitizeUrl(o[f]);
  }
  return o;
}

/**
 * Collect everything for a backup. Secrets are stripped (counted in
 * secretsExcluded). Incognito content is never in storage, so it cannot
 * appear here.
 */
export async function collectBackup(kv: KeyValueStore, secure: SecureKV): Promise<BackupFile> {
  // Chat threads: enumerate by key prefix.
  const allKeys = await kv.getAllKeys();
  const chatKeys = allKeys.filter((k) => k.startsWith(CHAT_PREFIX) && k.endsWith(CHAT_SUFFIX));
  const threads: BackupChatThread[] = [];
  for (const key of chatKeys) {
    const id = key.slice(CHAT_PREFIX.length, -CHAT_SUFFIX.length);
    const messages = (await readJson(kv, key)) as unknown[];
    threads.push({ id, messages: Array.isArray(messages) ? messages : [] });
  }
  threads.sort((a, b) => (a.id < b.id ? -1 : 1));

  // API groups live in SecureStore — read, then strip secrets.
  let groups: unknown[] = [];
  let apiKeys = 0;
  try {
    const raw = await secure.getItem(GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      groups = parsed.map((g) => {
        const { group, hadKey } = stripApiGroup(g);
        if (hadKey) apiKeys += 1;
        return group;
      });
    }
  } catch {
    groups = [];
  }

  // Plain AsyncStorage keys (non-secret by design).
  const plain: Record<string, unknown> = {};
  for (const key of PLAIN_KEYS) {
    const v = await readJson(kv, key);
    if (v !== null) plain[key] = v;
  }
  // Voice configs live in SecureStore in production (voice/store.ts writes
  // TTS_KEY/STT_KEY there, never to AsyncStorage) — read them from the
  // secure backend, then strip custom keys and sanitize URLs.
  let ttsKeys = 0;
  let sttKeys = 0;
  for (const key of SECURE_VOICE_KEYS) {
    const raw = await readSecureJson(secure, key);
    if (raw === null) continue;
    const { config, hadKey } = stripVoiceConfig(raw, "customKey");
    plain[key] = sanitizeConfigUrls(config);
    if (hadKey) {
      if (key === TTS_KEY) ttsKeys += 1;
      else sttKeys += 1;
    }
  }

  // AI-auth preferences: base key + per-capability keys.
  const aiAuth: Record<string, unknown> = {};
  const aiAuthKeys = allKeys.filter((k) => k === AI_AUTH_KEY || k.startsWith(`${AI_AUTH_KEY}.`));
  for (const key of aiAuthKeys) {
    const v = await readJson(kv, key);
    if (v !== null) aiAuth[key] = v;
  }

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    secretsExcluded: { apiKeys, ttsKeys, sttKeys },
    chat: { threads },
    apiGroups: groups,
    plain,
    aiAuth,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Parse + validate a backup file. Fails loudly with a machine-readable
 * code — never silently accepts a bad file.
 */
export function parseBackup(text: string): ParseBackupResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (e) {
    return {
      ok: false,
      code: "not-json",
      detail: e instanceof Error ? e.message : undefined,
    };
  }
  if (!isRecord(parsed)) return { ok: false, code: "invalid-shape" };
  if (parsed.kind !== BACKUP_KIND) {
    return { ok: false, code: "bad-kind", detail: `kind=${JSON.stringify(parsed.kind)}` };
  }
  if (parsed.version !== BACKUP_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      detail: `version=${JSON.stringify(parsed.version)}`,
    };
  }
  if (
    !isRecord(parsed.chat) ||
    !Array.isArray(parsed.chat.threads) ||
    !Array.isArray(parsed.apiGroups) ||
    !isRecord(parsed.plain) ||
    !isRecord(parsed.aiAuth) ||
    !isRecord(parsed.secretsExcluded)
  ) {
    return { ok: false, code: "invalid-shape" };
  }
  return { ok: true, backup: parsed as unknown as BackupFile };
}

/**
 * Apply a validated backup (replace semantics). Everything is validated
 * by parseBackup BEFORE this runs; this function writes all keys.
 * Secrets are NOT restored (they were never in the file) — groups come
 * back without keys and the UI must tell the user to re-enter them.
 */
export async function applyBackup(
  backup: BackupFile,
  kv: KeyValueStore,
  secure: SecureKV,
): Promise<void> {
  // Chat threads: write the backup's threads FIRST, then clear stale keys.
  // Crash-safe ordering — a crash midway leaves old data plus new data,
  // never a wiped store with nothing written.
  const wantedIds = new Set<string>();
  for (const thread of backup.chat.threads) {
    if (typeof thread.id !== "string") continue;
    wantedIds.add(thread.id);
    await kv.setItem(
      `${CHAT_PREFIX}${thread.id}${CHAT_SUFFIX}`,
      JSON.stringify(Array.isArray(thread.messages) ? thread.messages : []),
    );
  }
  const allKeys = await kv.getAllKeys();
  for (const key of allKeys) {
    if (!key.startsWith(CHAT_PREFIX) || !key.endsWith(CHAT_SUFFIX)) continue;
    const id = key.slice(CHAT_PREFIX.length, -CHAT_SUFFIX.length);
    if (!wantedIds.has(id)) {
      await kv.setItem(key, JSON.stringify([]));
    }
  }

  // API groups (keyless) go back to SecureStore.
  await secure.setItem(GROUPS_KEY, JSON.stringify(backup.apiGroups));

  // Voice configs go back to SecureStore (production layout — voice/store.ts
  // reads TTS_KEY/STT_KEY from the secure backend, never AsyncStorage).
  for (const key of SECURE_VOICE_KEYS) {
    if (key in backup.plain) {
      await secure.setItem(key, JSON.stringify(backup.plain[key]));
    }
  }

  // Plain keys (voice keys are handled above via the secure backend).
  for (const [key, value] of Object.entries(backup.plain)) {
    if ((SECURE_VOICE_KEYS as readonly string[]).includes(key)) continue;
    if (!PLAIN_KEYS.includes(key)) continue; // never write unknown keys
    await kv.setItem(key, JSON.stringify(value));
  }

  // AI-auth prefs.
  for (const [key, value] of Object.entries(backup.aiAuth)) {
    if (key !== AI_AUTH_KEY && !key.startsWith(`${AI_AUTH_KEY}.`)) continue;
    await kv.setItem(key, JSON.stringify(value));
  }

  // NOTE: LAST_BACKUP_KEY is deliberately NOT written here — "last backup"
  // means when an export happened, and a restore is not an export.
}

export async function getLastBackupAt(kv: KeyValueStore): Promise<string | null> {
  try {
    const raw = await kv.getItem(LAST_BACKUP_KEY);
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

export async function markBackedUp(kv: KeyValueStore): Promise<void> {
  await kv.setItem(LAST_BACKUP_KEY, JSON.stringify(new Date().toISOString()));
}
