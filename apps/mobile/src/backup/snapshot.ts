/**
 * Auto-snapshot — local scheduled snapshots with retention. PURE module.
 *
 * Learned from Kelivo's local_snapshot_service.dart + local_snapshot_retention.dart:
 * - Takes a full backup snapshot on a schedule (daily/weekly).
 * - Keeps N recent snapshots (retention slots); prunes older ones.
 * - Takes a safety snapshot BEFORE a restore (so a bad restore is undoable).
 *
 * Snapshots are stored as files via the injected FileBackend (expo-file-system
 * in production, in-memory fake in tests). The backup JSON comes from
 * backup.ts serializeBackup — this module only handles scheduling/storage.
 */

/** Snapshot metadata. */
export interface SnapshotInfo {
  id: string;
  /** Unix ms when taken. */
  createdAt: number;
  /** Why it was taken: "schedule" | "pre-restore" | "manual". */
  reason: "schedule" | "pre-restore" | "manual";
  /** Byte size of the snapshot file. */
  size: number;
}

/** Auto-snapshot settings. */
export interface SnapshotSettings {
  enabled: boolean;
  /** "daily" | "weekly" */
  frequency: "daily" | "weekly";
  /** How many snapshots to keep (oldest pruned first). */
  keepCount: number;
  /** Last time a scheduled snapshot was taken (unix ms). */
  lastTakenAt: number | null;
}

/** Minimal file backend. */
export interface SnapshotFileBackend {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
}

/** Minimal KV for settings. */
export interface SnapshotKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const SETTINGS_KEY = "dudu.snapshot.v1.settings";
const SNAPSHOT_DIR = "dudu-snapshots";

export const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  enabled: false,
  frequency: "daily",
  keepCount: 7,
  lastTakenAt: null,
};

function snapshotFilename(info: SnapshotInfo): string {
  return `${info.id}.json`;
}

export function createSnapshotStore(kv: SnapshotKV, files: SnapshotFileBackend) {
  async function loadSettings(): Promise<SnapshotSettings> {
    try {
      const raw = await kv.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SNAPSHOT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SNAPSHOT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SNAPSHOT_SETTINGS };
    }
  }

  async function saveSettings(s: SnapshotSettings): Promise<void> {
    await kv.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  return {
    async getSettings(): Promise<SnapshotSettings> {
      return loadSettings();
    },

    async updateSettings(patch: Partial<SnapshotSettings>): Promise<SnapshotSettings> {
      const cur = await loadSettings();
      const next: SnapshotSettings = {
        ...cur,
        ...patch,
        keepCount: Math.max(1, Math.min(30, patch.keepCount ?? cur.keepCount)),
      };
      await saveSettings(next);
      return next;
    },

    /** List snapshots, newest first. */
    async list(): Promise<SnapshotInfo[]> {
      let files_: string[];
      try {
        files_ = await files.listFiles(SNAPSHOT_DIR);
      } catch {
        return [];
      }
      const infos: SnapshotInfo[] = [];
      for (const f of files_) {
        if (!f.endsWith(".json")) continue;
        const id = f.replace(/\.json$/, "");
        try {
          const content = await files.readFile(`${SNAPSHOT_DIR}/${f}`);
          // Metadata is injected as {"snapshotMeta":{...}, at the start.
          const m = content.match(/^\{"snapshotMeta":(\{[^{}]*\}),/);
          if (m) {
            const meta = JSON.parse(m[1]) as { id?: string; createdAt?: number; reason?: string };
            infos.push({
              id: meta.id ?? id,
              createdAt: meta.createdAt ?? 0,
              reason: (meta.reason as SnapshotInfo["reason"]) ?? "manual",
              size: content.length,
            });
            continue;
          }
        } catch {
          // fall through to corrupt entry
        }
        // Corrupt or legacy file — still list it so the user can delete it.
        infos.push({ id, createdAt: 0, reason: "manual", size: 0 });
      }
      return infos.sort((a, b) => b.createdAt - a.createdAt);
    },

    /**
     * Take a snapshot. `backupJson` is the serialized backup from backup.ts.
     * Prunes old snapshots beyond keepCount.
     */
    async take(backupJson: string, reason: SnapshotInfo["reason"]): Promise<SnapshotInfo> {
      const settings = await loadSettings();
      const info: SnapshotInfo = {
        id: `snap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        reason,
        size: backupJson.length,
      };
      // Embed metadata at the top for list() to read without parsing all.
      const withMeta = backupJson.replace(
        "{",
        `{"snapshotMeta":{"id":"${info.id}","createdAt":${info.createdAt},"reason":"${reason}"},`,
      );
      await files.writeFile(`${SNAPSHOT_DIR}/${snapshotFilename(info)}`, withMeta);

      // Prune beyond keepCount (oldest first, never prune pre-restore).
      const all = await this.list();
      const prunable = all.filter((s) => s.reason !== "pre-restore");
      const excess = prunable.length - settings.keepCount;
      for (let i = 0; i < excess; i++) {
        const victim = prunable[prunable.length - 1 - i];
        try {
          await files.deleteFile(`${SNAPSHOT_DIR}/${snapshotFilename(victim)}`);
        } catch {
          // ignore
        }
      }

      if (reason === "schedule") {
        await saveSettings({ ...settings, lastTakenAt: info.createdAt });
      }
      return info;
    },

    async read(id: string): Promise<string> {
      const raw = await files.readFile(`${SNAPSHOT_DIR}/${id}.json`);
      // Strip the injected snapshotMeta before handing to parseBackup.
      return raw.replace(/\{"snapshotMeta":\{[^}]*\},/, "{");
    },

    async remove(id: string): Promise<void> {
      await files.deleteFile(`${SNAPSHOT_DIR}/${id}.json`);
    },

    /**
     * Check if a scheduled snapshot is due. Call on app start / foreground.
     * Returns true when a snapshot should be taken now.
     */
    async isDue(now: number = Date.now()): Promise<boolean> {
      const s = await loadSettings();
      if (!s.enabled) return false;
      if (!s.lastTakenAt) return true;
      const interval = s.frequency === "daily" ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
      return now - s.lastTakenAt >= interval;
    },
  };
}

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
