/**
 * Voice cache cleanup (P2-24).
 *
 * Synthesized speech piles up and was never cleaned: TTS clips in
 * `<cache>/dudu-tts/` and generated podcasts in `<documents>/dudu-podcasts/`.
 * Voice *messages* (`dudu-voice-messages/`) are her data — never touched here.
 *
 * PURE module: expo-file-system is loaded lazily so this stays importable
 * in plain node tests.
 */

async function loadFs() {
  const mod = await import("expo-file-system/legacy");
  return mod as typeof import("expo-file-system/legacy");
}

/** Files older than this are considered stale. */
export const VOICE_CACHE_MAX_AGE_DAYS = 30;

async function cacheDirs(): Promise<string[]> {
  const fs = await loadFs();
  const base = fs.cacheDirectory ?? fs.documentDirectory ?? "";
  if (!base) return [];
  // dudu-podcasts lives under documentDirectory; check both bases.
  const docBase = fs.documentDirectory ?? fs.cacheDirectory ?? "";
  const dirs = [`${base}dudu-tts/`, `${docBase}dudu-podcasts/`];
  const out: string[] = [];
  for (const d of dirs) {
    try {
      const info = await fs.getInfoAsync(d);
      if (info.exists) out.push(d);
    } catch {
      // best-effort: skip unreadable dirs
    }
  }
  return out;
}

/** Total bytes currently sitting in our voice caches. */
export async function getVoiceCacheSize(): Promise<number> {
  const fs = await loadFs();
  let total = 0;
  for (const dir of await cacheDirs()) {
    let names: string[] = [];
    try {
      names = await fs.readDirectoryAsync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const info = await fs.getInfoAsync(`${dir}${name}`);
        if (info.exists && !info.isDirectory) total += info.size ?? 0;
      } catch {
        // skip
      }
    }
  }
  return total;
}

export interface CacheCleanResult {
  deleted: number;
  freedBytes: number;
}

/**
 * Delete cached voice files older than `maxAgeDays`.
 * Returns what was removed. Never throws — cleanup must not break the app.
 */
export async function cleanVoiceCache(
  maxAgeDays: number = VOICE_CACHE_MAX_AGE_DAYS,
): Promise<CacheCleanResult> {
  const fs = await loadFs();
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let deleted = 0;
  let freedBytes = 0;
  try {
    for (const dir of await cacheDirs()) {
      let names: string[] = [];
      try {
        names = await fs.readDirectoryAsync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const path = `${dir}${name}`;
        try {
          const info = await fs.getInfoAsync(path);
          if (!info.exists || info.isDirectory) continue;
          const mtime = (info as { modificationTime?: number }).modificationTime ?? 0;
          if (mtime * 1000 < cutoff) {
            await fs.deleteAsync(path, { idempotent: true });
            deleted += 1;
            freedBytes += info.size ?? 0;
          }
        } catch {
          // keep going — one bad file shouldn't stop cleanup
        }
      }
    }
  } catch {
    // never throw
  }
  return { deleted, freedBytes };
}

/** Human-friendly byte count, e.g. "3.2 MB". Locale picked by caller. */
export function formatBytes(bytes: number, zh: boolean): string {
  if (bytes < 1024) return zh ? `${bytes} 字节` : `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return zh ? `${kb.toFixed(1)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return zh ? `${mb.toFixed(1)} MB` : `${mb.toFixed(1)} MB`;
}
