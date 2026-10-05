/**
 * Backup & restore — pure logic, aligned with Kelivo.
 *
 * One-tap export produces a single versioned JSON file:
 *   { "kind": "dudu-backup", "version": 1, "exportedAt": ..., ... }
 *
 * Included: chat threads, API group configs (WITHOUT keys), theme bundles,
 * voice/vision configs (WITHOUT keys), permission + AI-auth preferences,
 * app settings (font, font size, chat mode), memories (profile/memories/
 * events/auto-extract pref), skills, our-space (diary/timeline/tell-later/
 * status/her-mood/couple/feed/replies/anniversaries/works/task cards), knowledge
 * base (docs + chunks INCLUDING vectors, so search works after restore
 * even though API keys are never backed up), the music library
 * (tracks/playlists/queue/comments/together/now-playing/DJ intent),
 * capability groups + routing prefs, model profiles, dialogs (registry +
 * model overrides), cross-dialog trace + visibility, group meetings,
 * plan gate, outreach prefs (frequency/last opened), sandbox backend
 * choice, ambient video overrides, AI theme mode.
 *
 * NEVER included:
 * - Secrets (API keys, custom TTS/STT keys, extra headers). They live in
 *   SecureStore and are stripped on export. Restore warns the user to
 *   re-enter them. We do NOT invent homebrew encryption.
 * - Session/Apple-Music/SSH secrets (dudu.session.token, the Apple Music
 *   user token, dudu.sandbox.sshConfig.v1 — the last one can hold a
 *   private key or password). All live in SecureStore and stay there.
 * - Incognito content. It is never persisted to storage, so it cannot
 *   end up in a backup (there is a test for this).
 * - Cached audio/images (regenerable, bulky) — EXCEPT her voice message
 *   recordings, which are irreplaceable and ARE backed up (P2-5).
 *
 * Restore validates the whole file BEFORE writing anything. Corrupt files
 * fail with a human-readable error code — never half-apply.
 */

import type { KbChunkRecord, KbDoc } from "./knowledge/store";

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

// Memories (memory/store.ts): profile + memories + audit events + the
// auto-extract kill switch. No secrets — safe as plain JSON.
const MEMORY_KEYS = [
  "dudu.memory.v1.profile",
  "dudu.memory.v1.memories",
  "dudu.memory.v1.events",
  "dudu.memory.v1.autoExtract",
] as const;

// Skills (skills/store.ts): name/description/instructions — no secrets.
const SKILLS_KEYS = ["dudu.skills.v1.list"] as const;

// Our-space (our-space/store.ts): the couple's space, all sections.
const OURSPACE_KEYS = [
  "dudu.ourspace.v1.diary",
  "dudu.ourspace.v1.timeline",
  "dudu.ourspace.v1.telllater",
  "dudu.ourspace.v1.status",
  "dudu.ourspace.v1.herMood",
  "dudu.ourspace.v1.leftNotes",
  "dudu.ourspace.v1.loveLetters",
  "dudu.ourspace.v2.couple",
  "dudu.ourspace.v2.feed",
  "dudu.ourspace.v2.replies",
  "dudu.ourspace.v2.anniversaries",
  "dudu.ourspace.v2.works",
] as const;

// Task progress cards (our-space/task-progress.ts) — enumerated by prefix.
const TASKS_PREFIX = "dudu.tasks.v1.";

// Music library (music/store.ts): tracks, playlists, queue, comments,
// "our songs" counters, now-playing, DJ intent. No secrets — the Apple
// Music user token lives in SecureStore and is never backed up.
const MUSIC_KEYS = [
  "dudu.music.v1.tracks",
  "dudu.music.v1.playlists",
  "dudu.music.v1.queue",
  "dudu.music.v1.comments",
  "dudu.music.v1.memories",
  "dudu.music.v1.together",
  "dudu.music.v1.togetherListens",
  "dudu.music.v1.now",
  "dudu.music.v1.intent",
  "dudu.music.v1.intent.appliedAt",
  "dudu.music.v1.selectedLyric",
  "dudu.music.v1.apple-music.auth-state",
] as const;

// Capability routing (api-groups/capability-store.ts): capability groups
// + routing switches. Member endpoint URLs get secret query params
// stripped like API group URLs (counted in secretsExcluded.urlsSanitized).
const CAPABILITY_GROUPS_KEY = "dudu.capability-groups.v1";

// Everything else user-owned that previously fell through the cracks
// (round-3 product/code audits): dialogs, coordination, meetings,
// outreach prefs, sandbox backend choice, ambient video overrides,
// AI theme mode.
const EXTENSION_KEYS = [
  ...MUSIC_KEYS,
  CAPABILITY_GROUPS_KEY,
  "dudu.capability-routing-enabled.v1",
  "dudu.multi-model-coordination.v1",
  "dudu.ranking-mode.v1",
  "dudu.model-profiles.v1",
  "dudu.dialog-registry.v1",
  "dudu.dialog-model-override.v1",
  "dudu.cross-dialog-trace.v1",
  "dudu.cross-dialog-visibility.v1",
  "dudu.group-meetings.v1",
  "dudu.plan-gate.v1",
  "dudu.outreach.v1.frequency",
  "dudu.outreach.v1.lastOpened",
  "dudu.outreach.v1.lastOutreach",
  "dudu.outreach.v1.loveLetterNudges",
  "dudu.sandbox.activeBackend.v1",
  "dudu.ambientvideo.v1.overrides",
  "dudu.theme.aiMode.v1",
] as const;

// TTS/STT configs live in SecureStore in production (voice/store.ts) —
// never in plain AsyncStorage. They are read/written via the secure backend.
const SECURE_VOICE_KEYS = [TTS_KEY, STT_KEY] as const;

export interface SecretsExcluded {
  apiKeys: number;
  ttsKeys: number;
  sttKeys: number;
  /** Custom request headers stripped from API groups (re-enter after restore). */
  headersExcluded: number;
  /**
   * Config URLs (baseUrl/customUrl/url) that had secret-looking query
   * params (?key=, ?token=, …) removed on export. The URLs in the backup
   * differ from the originals — disclosed, never silent.
   */
  urlsSanitized: number;
}

export interface BackupChatThread {
  id: string;
  /**
   * The thread's stored payload, verbatim: v2 envelope
   * `{ v: 2, messages, meta }` or a legacy v1 bare array. Stored verbatim
   * so version selections and thread meta survive backup/restore (A2).
   * Older backups carry `messages` instead — restore handles both.
   */
  data?: unknown;
  /** Legacy shape (pre-A2 backups). Read-only for restore. */
  messages?: unknown[];
}

/**
 * Knowledge base dump: docs + chunks (vectors included). The SQLite store
 * is injected so backup.ts stays pure/testable — production passes the
 * real SqliteKnowledgeStore, tests pass a fake.
 */
export interface KnowledgeBackupTarget {
  listDocs(): Promise<KbDoc[]>;
  listChunks(): Promise<KbChunkRecord[]>;
  restoreSnapshot(docs: KbDoc[], chunks: KbChunkRecord[]): Promise<void>;
}

export interface BackupKnowledge {
  docs: KbDoc[];
  chunks: KbChunkRecord[];
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
  /** Optional (newer backups): memories keyed by storage key. */
  memories?: Record<string, unknown>;
  /** Optional (newer backups): skills keyed by storage key. */
  skills?: Record<string, unknown>;
  /** Optional (newer backups): our-space + task cards keyed by storage key. */
  ourSpace?: Record<string, unknown>;
  /** Optional (newer backups): extended user-owned sections keyed by storage key. */
  extensions?: Record<string, unknown>;
  /** Optional (newer backups): knowledge base snapshot. */
  knowledge?: BackupKnowledge;
  /**
   * Optional (newer backups): her voice message recordings, filename →
   * base64 m4a. Restored into stable storage with message URIs rewritten,
   * so old voice bubbles keep playing on a new device. (P2-5)
   */
  voiceMessages?: Record<string, string>;
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

function stripApiGroup(g: unknown): {
  group: unknown;
  hadKey: boolean;
  hadHeaders: boolean;
  hadApiKeys: boolean;
  sanitized: boolean;
} {
  if (typeof g !== "object" || g === null)
    return { group: g, hadKey: false, hadHeaders: false, hadApiKeys: false, sanitized: false };
  const o = g as Record<string, unknown>;
  const hadKey = typeof o.apiKey === "string" && o.apiKey.length > 0;
  const hadHeaders =
    typeof o.headers === "object" &&
    o.headers !== null &&
    Object.keys(o.headers as Record<string, unknown>).length > 0;
  // B2: the key pool holds raw secrets — never into a backup file.
  const hadApiKeys = Array.isArray(o.apiKeys) && o.apiKeys.length > 0;
  const { apiKey: _ak, headers: _h, apiKeys: _aks, ...rest } = o;
  const { config, sanitized } = sanitizeConfigUrls(rest);
  return { group: config, hadKey, hadHeaders, hadApiKeys, sanitized };
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

/** True for the v2 chat-history envelope `{ v: 2, messages, meta }`. */
function isEnvelope(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { v?: unknown }).v === 2 &&
    Array.isArray((v as { messages?: unknown }).messages)
  );
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

/** Sanitize URL-ish fields on a config object (baseUrl/customUrl/url).
 * Returns the sanitized copy plus whether any URL was actually changed
 * (so the caller can disclose the rewrite instead of doing it silently). */
function sanitizeConfigUrls(cfg: unknown): { config: unknown; sanitized: boolean } {
  if (typeof cfg !== "object" || cfg === null) return { config: cfg, sanitized: false };
  const o = { ...(cfg as Record<string, unknown>) };
  let sanitized = false;
  for (const f of ["baseUrl", "customUrl", "url"]) {
    if (typeof o[f] === "string") {
      const cleaned = sanitizeUrl(o[f]);
      if (cleaned !== o[f]) sanitized = true;
      o[f] = cleaned;
    }
  }
  return { config: o, sanitized };
}

/**
 * Strip secret-looking query params from capability-group member URLs
 * (endpoint / pollEndpoint) — same threat class as API group URLs:
 * she could paste a key-bearing URL into either field.
 */
function sanitizeCapabilityGroups(v: unknown): { groups: unknown; sanitized: number } {
  if (!Array.isArray(v)) return { groups: v, sanitized: 0 };
  let n = 0;
  const groups = v.map((g) => {
    if (typeof g !== "object" || g === null) return g;
    const o = { ...(g as Record<string, unknown>) };
    if (Array.isArray(o.members)) {
      o.members = (o.members as unknown[]).map((m) => {
        if (typeof m !== "object" || m === null) return m;
        const mm = { ...(m as Record<string, unknown>) };
        for (const f of ["endpoint", "pollEndpoint"]) {
          if (typeof mm[f] === "string") {
            const cleaned = sanitizeUrl(mm[f]);
            if (cleaned !== mm[f]) n += 1;
            mm[f] = cleaned;
          }
        }
        return mm;
      });
    }
    return o;
  });
  return { groups, sanitized: n };
}

/**
 * Collect everything for a backup. Secrets are stripped (counted in
 * secretsExcluded). Incognito content is never in storage, so it cannot
 * appear here.
 *
 * `knowledge` is optional (the SQLite store needs async init and tests
 * may not have one) — when absent the knowledge section is skipped.
 */
export async function collectBackup(
  kv: KeyValueStore,
  secure: SecureKV,
  knowledge?: KnowledgeBackupTarget | null,
): Promise<BackupFile> {
  // Chat threads: enumerate by key prefix.
  const allKeys = await kv.getAllKeys();
  const chatKeys = allKeys.filter((k) => k.startsWith(CHAT_PREFIX) && k.endsWith(CHAT_SUFFIX));
  const threads: BackupChatThread[] = [];
  for (const key of chatKeys) {
    const id = key.slice(CHAT_PREFIX.length, -CHAT_SUFFIX.length);
    const data = await readJson(kv, key);
    threads.push({ id, data: data ?? [] });
  }
  threads.sort((a, b) => (a.id < b.id ? -1 : 1));

  // API groups live in SecureStore — read, then strip secrets.
  let groups: unknown[] = [];
  let apiKeys = 0;
  let headersExcluded = 0;
  let urlsSanitized = 0;
  try {
    const raw = await secure.getItem(GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      groups = parsed.map((g) => {
        const { group, hadKey, hadHeaders, hadApiKeys, sanitized } = stripApiGroup(g);
        if (hadKey || hadApiKeys) apiKeys += 1;
        if (hadHeaders) headersExcluded += 1;
        if (sanitized) urlsSanitized += 1;
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
    const { config: sanitizedCfg, sanitized } = sanitizeConfigUrls(config);
    if (sanitized) urlsSanitized += 1;
    plain[key] = sanitizedCfg;
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

  // Memories: profile, memory records, audit events, auto-extract switch.
  const memories: Record<string, unknown> = {};
  for (const key of MEMORY_KEYS) {
    const v = await readJson(kv, key);
    if (v !== null) memories[key] = v;
  }

  // Skills: her taught capability packs (no secrets).
  const skills: Record<string, unknown> = {};
  for (const key of SKILLS_KEYS) {
    const v = await readJson(kv, key);
    if (v !== null) skills[key] = v;
  }

  // Our-space: fixed section keys + task progress cards (prefix-enumerated).
  const ourSpace: Record<string, unknown> = {};
  for (const key of OURSPACE_KEYS) {
    const v = await readJson(kv, key);
    if (v !== null) ourSpace[key] = v;
  }
  for (const key of allKeys) {
    if (!key.startsWith(TASKS_PREFIX)) continue;
    const v = await readJson(kv, key);
    if (v !== null) ourSpace[key] = v;
  }

  // Extended sections: every user-owned key that used to fall through the
  // cracks (music, capability groups, dialogs, coordination, meetings,
  // outreach prefs...). Capability group member URLs get secret query
  // params stripped, same as API group URLs.
  const extensions: Record<string, unknown> = {};
  for (const key of EXTENSION_KEYS) {
    const v = await readJson(kv, key);
    if (v === null) continue;
    if (key === CAPABILITY_GROUPS_KEY) {
      const { groups, sanitized } = sanitizeCapabilityGroups(v);
      urlsSanitized += sanitized;
      extensions[key] = groups;
    } else {
      extensions[key] = v;
    }
  }

  // Knowledge base: full snapshot (docs + chunks with vectors) so search
  // keeps working after restore without re-embedding (API keys are never
  // backed up, so re-embedding would silently fail).
  let kb: BackupKnowledge | undefined;
  if (knowledge) {
    try {
      const docs = await knowledge.listDocs();
      const chunks = await knowledge.listChunks();
      kb = { docs, chunks };
    } catch {
      // Knowledge store unavailable — skip the section, never fail backup.
      kb = undefined;
    }
  }

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    secretsExcluded: { apiKeys, ttsKeys, sttKeys, headersExcluded, urlsSanitized },
    chat: { threads },
    apiGroups: groups,
    plain,
    aiAuth,
    memories,
    skills,
    ourSpace,
    extensions,
    knowledge: kb,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** A backed-up knowledge doc: ids/names kept, content trusted only loosely. */
function isBackupDoc(v: unknown): v is KbDoc {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.kind === "txt" || v.kind === "md" || v.kind === "pdf") &&
    typeof v.chunkCount === "number" &&
    (v.status === "ready" || v.status === "indexing" || v.status === "failed")
  );
}

/** A backed-up knowledge chunk. Vectors are filtered to numbers on restore. */
function isBackupChunk(v: unknown): v is KbChunkRecord {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.docId === "string" &&
    typeof v.index === "number" &&
    typeof v.text === "string"
  );
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
  // Newer optional sections: must be records when present, otherwise the
  // file is corrupt. Old backups (without them) still restore fine.
  for (const field of ["memories", "skills", "ourSpace", "extensions"] as const) {
    if (parsed[field] !== undefined && !isRecord(parsed[field])) {
      return { ok: false, code: "invalid-shape" };
    }
  }
  if (parsed.knowledge !== undefined) {
    const k = parsed.knowledge;
    if (
      !isRecord(k) ||
      !Array.isArray(k.docs) ||
      !Array.isArray(k.chunks) ||
      !k.docs.every(isBackupDoc) ||
      !k.chunks.every(isBackupChunk)
    ) {
      return { ok: false, code: "invalid-shape" };
    }
  }
  return { ok: true, backup: parsed as unknown as BackupFile };
}

/**
 * Apply a validated backup (replace semantics). Everything is validated
 * by parseBackup BEFORE this runs; this function writes all keys.
 * Secrets are NOT restored (they were never in the file) — groups come
 * back without keys and the UI must tell the user to re-enter them.
 *
 * `knowledge` is optional — when present, the knowledge snapshot is
 * restored through it; when absent, the section is skipped.
 */
export async function applyBackup(
  backup: BackupFile,
  kv: KeyValueStore,
  secure: SecureKV,
  knowledge?: KnowledgeBackupTarget | null,
): Promise<void> {
  // Chat threads: write the backup's threads FIRST, then clear stale keys.
  // Crash-safe ordering — a crash midway leaves old data plus new data,
  // never a wiped store with nothing written.
  const wantedIds = new Set<string>();
  for (const thread of backup.chat.threads) {
    if (typeof thread.id !== "string") continue;
    wantedIds.add(thread.id);
    // A2: write the stored payload back verbatim (v2 envelope or legacy
    // v1 array) — version selections and thread meta survive the round trip.
    const payload = thread.data !== undefined ? thread.data : thread.messages;
    await kv.setItem(
      `${CHAT_PREFIX}${thread.id}${CHAT_SUFFIX}`,
      JSON.stringify(Array.isArray(payload) || isEnvelope(payload) ? payload : []),
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

  // Memories: allowlisted keys only — a crafted backup must not be able
  // to write arbitrary storage keys.
  if (backup.memories) {
    for (const [key, value] of Object.entries(backup.memories)) {
      if (!(MEMORY_KEYS as readonly string[]).includes(key)) continue;
      await kv.setItem(key, JSON.stringify(value));
    }
  }

  // Skills: same allowlist discipline.
  if (backup.skills) {
    for (const [key, value] of Object.entries(backup.skills)) {
      if (!(SKILLS_KEYS as readonly string[]).includes(key)) continue;
      await kv.setItem(key, JSON.stringify(value));
    }
  }

  // Our-space: fixed keys (allowlisted) + task cards (prefix).
  // Task cards get replace semantics like chat threads: write the
  // backup's cards first, then clear stale ones not in the backup.
  if (backup.ourSpace) {
    const wantedTaskKeys = new Set<string>();
    for (const [key, value] of Object.entries(backup.ourSpace)) {
      const isFixed = (OURSPACE_KEYS as readonly string[]).includes(key);
      const isTask = key.startsWith(TASKS_PREFIX);
      if (!isFixed && !isTask) continue;
      if (isTask) wantedTaskKeys.add(key);
      await kv.setItem(key, JSON.stringify(value));
    }
    const currentKeys = await kv.getAllKeys();
    for (const key of currentKeys) {
      if (!key.startsWith(TASKS_PREFIX)) continue;
      if (!wantedTaskKeys.has(key)) {
        await kv.setItem(key, JSON.stringify([]));
      }
    }
  }

  // Extended sections: allowlisted keys only — a crafted backup must not
  // be able to write arbitrary storage keys.
  if (backup.extensions) {
    for (const [key, value] of Object.entries(backup.extensions)) {
      if (!(EXTENSION_KEYS as readonly string[]).includes(key)) continue;
      await kv.setItem(key, JSON.stringify(value));
    }
  }

  // Knowledge base: single-transaction snapshot restore (original ids
  // preserved, vectors included). Docs stuck in "indexing" at backup
  // time are marked failed — they were mid-index when exported and will
  // never finish; she can delete and re-upload.
  if (backup.knowledge && knowledge) {
    const docs: KbDoc[] = backup.knowledge.docs.map((d) => ({
      ...d,
      status: d.status === "indexing" ? "failed" : d.status,
      error: d.status === "indexing" ? "interruptedRestore" : d.error,
    }));
    const chunks: KbChunkRecord[] = backup.knowledge.chunks
      .filter((c) => docs.some((d) => d.id === c.docId))
      .map((c) => ({
        ...c,
        vector: Array.isArray(c.vector) ? c.vector.filter((v) => typeof v === "number") : [],
        embedModel: typeof c.embedModel === "string" ? c.embedModel : "",
        headingPath: typeof c.headingPath === "string" ? c.headingPath : "",
      }));
    await knowledge.restoreSnapshot(docs, chunks);
  }

  // NOTE: LAST_BACKUP_KEY is deliberately NOT written here — "last backup"
  // means when an export happened, and a restore is not an export.
}

/**
 * Coverage self-check (round-3 P2-8 suggestion): given the keys present in
 * storage, report the `dudu.*` keys this backup does NOT cover. Secrets and
 * internal bookkeeping are deliberately excluded and never reported.
 * Wire any real gap into EXTENSION_KEYS or one of the dedicated sections.
 */
const KNOWN_UNBACKED_KEYS: ReadonlySet<string> = new Set([
  "dudu.session.token", // secret (SecureStore)
  "dudu.music.v1.apple-music.user-token", // secret (SecureStore)
  "dudu.sandbox.sshConfig.v1", // secrets: can hold a private key or password (SecureStore)
  "dudu.backup.lastAt.v1", // bookkeeping, not her data
  "dudu.kb.v2.migrated", // internal migration flag
]);

function isKeyCovered(key: string): boolean {
  if (key.startsWith(CHAT_PREFIX) && key.endsWith(CHAT_SUFFIX)) return true;
  if (key.startsWith(TASKS_PREFIX)) return true;
  if (key.startsWith("dudu.kb.v1.")) return true; // covered by the knowledge section
  if (key === GROUPS_KEY) return true;
  if (key === AI_AUTH_KEY || key.startsWith(`${AI_AUTH_KEY}.`)) return true;
  const covered: readonly string[] = [
    ...PLAIN_KEYS,
    ...MEMORY_KEYS,
    ...SKILLS_KEYS,
    ...OURSPACE_KEYS,
    ...SECURE_VOICE_KEYS,
    ...EXTENSION_KEYS,
  ];
  return covered.includes(key);
}

export function findUnbackedKeys(allKeys: readonly string[]): string[] {
  const gaps: string[] = [];
  for (const key of allKeys) {
    if (!key.startsWith("dudu.")) continue;
    if (KNOWN_UNBACKED_KEYS.has(key)) continue;
    if (isKeyCovered(key)) continue;
    gaps.push(key);
  }
  return gaps.sort();
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
