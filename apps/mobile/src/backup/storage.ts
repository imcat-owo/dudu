/**
 * Storage space — calculate usage by category. PURE module.
 *
 * Learned from Kelivo's storage/settings approach: group keys by prefix,
 * sum the byte sizes, and report per-category so she knows what's eating
 * space and can clean it up.
 */

/** Minimal KV surface for scanning. */
export interface StorageKV {
  getItem(key: string): Promise<string | null>;
  getAllKeys(): Promise<readonly string[]>;
}

/** One storage category. */
export interface StorageCategory {
  id: string;
  /** Byte size. */
  bytes: number;
  /** Number of keys. */
  keys: number;
}

/** Full storage report. */
export interface StorageReport {
  categories: StorageCategory[];
  totalBytes: number;
  totalKeys: number;
}

/** Key prefix -> category mapping. Order matters (first match wins). */
const CATEGORY_RULES: { id: string; prefixes: string[] }[] = [
  { id: "chat", prefixes: ["dudu.local-chat."] },
  { id: "api-groups", prefixes: ["dudu.api-groups."] },
  { id: "memory", prefixes: ["dudu.memory."] },
  { id: "knowledge", prefixes: ["dudu.kb."] },
  { id: "theme", prefixes: ["dudu.theme.", "dudu.font."] },
  { id: "voice", prefixes: ["dudu.tts.", "dudu.stt.", "dudu.voice-"] },
  { id: "persona", prefixes: ["dudu.persona.", "dudu.worldbook."] },
  { id: "our-space", prefixes: ["dudu.our-space.", "dudu.diary.", "dudu.timeline."] },
  { id: "music", prefixes: ["dudu.music."] },
  { id: "snapshots", prefixes: ["dudu.snapshot."] },
  { id: "settings", prefixes: ["dudu.settings.", "dudu.backup."] },
];

function categorize(key: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.prefixes.some((p) => key.startsWith(p))) return rule.id;
  }
  return "other";
}

/** Calculate storage usage by category. */
export async function calculateStorage(kv: StorageKV): Promise<StorageReport> {
  const keys = await kv.getAllKeys();
  const byCategory = new Map<string, { bytes: number; keys: number }>();
  let totalBytes = 0;

  for (const key of keys) {
    if (!key.startsWith("dudu.")) continue;
    let value: string | null = null;
    try {
      value = await kv.getItem(key);
    } catch {
      continue;
    }
    const bytes = key.length + (value?.length ?? 0);
    totalBytes += bytes;
    const cat = categorize(key);
    const cur = byCategory.get(cat) ?? { bytes: 0, keys: 0 };
    cur.bytes += bytes;
    cur.keys += 1;
    byCategory.set(cat, cur);
  }

  const categories: StorageCategory[] = [...byCategory.entries()]
    .map(([id, v]) => ({ id, bytes: v.bytes, keys: v.keys }))
    .sort((a, b) => b.bytes - a.bytes);

  return { categories, totalBytes, totalKeys: keys.length };
}

/** Format bytes as human-readable (KB/MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
