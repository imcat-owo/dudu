/**
 * Backup & restore AI tools — let her trigger backup/restore by voice.
 * "凡事儿我能对他喊话，他能做到的，都能在对话框里完成。"
 *
 * PURE module: no React Native imports. File I/O, knowledge store access,
 * and post-restore store refreshes are injected via BackupToolDeps; the
 * real wiring lives in local-agent.ts.
 */

import type { LocalTool } from "./api-groups/local-tools.js";
import { ToolError } from "./api-groups/local-tools.js";
import {
  applyBackup,
  collectBackup,
  getLastBackupAt,
  type KeyValueStore,
  type KnowledgeBackupTarget,
  markBackedUp,
  parseBackup,
  type SecureKV,
  serializeBackup,
} from "./backup.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/** Injected device-side implementations (real ones wired in local-agent). */
export interface BackupToolDeps {
  kv: KeyValueStore;
  secure: SecureKV;
  /** Resolve the knowledge store for snapshot include/restore (may be null). */
  getKnowledgeStore: () => Promise<KnowledgeBackupTarget | null>;
  /** Persist the backup JSON somewhere she can reach; returns a human hint (path/share note). */
  saveBackupFile: (filename: string, json: string) => Promise<string>;
  /** List previously saved backup files (newest first). */
  listBackupFiles: () => Promise<Array<{ name: string; modifiedAt: number }>>;
  /** Read a previously saved backup file by name. */
  readBackupFile: (name: string) => Promise<string>;
  /** Refresh in-memory store mirrors after a restore (theme, voice, memory, …). */
  onRestored: () => Promise<void>;
}

function summarize(backup: {
  exportedAt: string;
  chat: { threads: Array<{ id: string }> };
  apiGroups: unknown[];
  secretsExcluded: { apiKeys: number; ttsKeys: number; sttKeys: number };
  knowledge?: { docs: unknown[]; chunks: unknown[] };
  memories?: Record<string, unknown>;
  skills?: Record<string, unknown>;
  ourSpace?: Record<string, unknown>;
}): string {
  const lines = [
    `Backup created at ${backup.exportedAt}.`,
    `Chat threads: ${backup.chat.threads.length}.`,
    `API groups: ${backup.apiGroups.length} (keys excluded: ${backup.secretsExcluded.apiKeys}).`,
  ];
  if (backup.knowledge) {
    lines.push(
      `Knowledge base: ${backup.knowledge.docs.length} docs, ${backup.knowledge.chunks.length} chunks (vectors included).`,
    );
  }
  const memKeys = backup.memories ? Object.keys(backup.memories).length : 0;
  const skillKeys = backup.skills ? Object.keys(backup.skills).length : 0;
  const spaceKeys = backup.ourSpace ? Object.keys(backup.ourSpace).length : 0;
  lines.push(
    `Memories sections: ${memKeys}, skills sections: ${skillKeys}, our-space sections: ${spaceKeys}.`,
  );
  lines.push(
    "Secrets (API keys, custom voice keys) were NOT backed up — she will need to re-enter them after a restore.",
  );
  return lines.join("\n");
}

/**
 * Build the backup/restore tool set.
 */
export function createBackupTools(deps: BackupToolDeps): LocalTool[] {
  return [
    {
      name: "backup_create",
      description:
        "Create a full backup of her app data (chat threads, API group configs WITHOUT keys, theme, voice settings, app settings, memories, skills, our-space incl. diary/timeline/anniversaries/task cards, knowledge base docs+vectors). Use when she says '备份一下' / '帮我备份'. The backup is saved to a file; secrets (API keys, custom voice keys) are never included. Returns a summary of what was backed up.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "backup",
      run: async () => {
        const knowledge = await deps.getKnowledgeStore().catch(() => null);
        const backup = await collectBackup(deps.kv, deps.secure, knowledge);
        const json = serializeBackup(backup);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `dudu-backup-${stamp}.json`;
        const savedHint = await deps.saveBackupFile(filename, json);
        await markBackedUp(deps.kv);
        return `${summarize(backup)}\nSaved: ${savedHint}`;
      },
    },
    {
      name: "backup_restore",
      description:
        "Restore app data from a backup. Use when she says '恢复备份' / '把数据恢复回来'. Either pass the backup JSON text directly in backup_json, or leave it empty to restore the most recent backup file saved on this device. The backup is validated BEFORE anything is written — a corrupt file fails safely without touching her data. After restore, API keys must be re-entered (they are never in backups). This overwrites current data; confirm with her first unless she explicitly asked.",
      parameters: {
        type: "object",
        properties: {
          backup_json: {
            type: "string",
            description:
              "Full text of a dudu-backup JSON file. Optional — when omitted, the most recent saved backup file is used.",
          },
        },
        additionalProperties: false,
      },
      manualId: "backup",
      run: async (args) => {
        let text = strArg(args, "backup_json").trim();
        let source = "provided JSON";
        if (!text) {
          const files = await deps.listBackupFiles().catch(() => []);
          if (files.length === 0) {
            throw new ToolError(
              "No backup file found on this device and no backup_json provided. Ask her to create a backup first (backup_create) or paste a backup JSON.",
            );
          }
          const latest = files[0];
          text = await deps.readBackupFile(latest.name);
          source = `file ${latest.name}`;
        }
        const parsed = parseBackup(text);
        if (!parsed.ok) {
          const hints: Record<string, string> = {
            empty: "The backup is empty.",
            "not-json": "Not valid JSON.",
            "bad-kind": "Not a 嘟嘟 backup file.",
            "unsupported-version":
              "Backup version is newer than this app supports — update the app first.",
            "invalid-shape": "Backup file is corrupt.",
          };
          throw new ToolError(
            `Backup validation failed (${source}): ${hints[parsed.code] ?? parsed.code}${parsed.detail ? ` ${parsed.detail}` : ""} Nothing was changed.`,
          );
        }
        const knowledge = await deps.getKnowledgeStore().catch(() => null);
        await applyBackup(parsed.backup, deps.kv, deps.secure, knowledge);
        await deps.onRestored();
        const b = parsed.backup;
        return [
          `Restore complete from ${source} (exported at ${b.exportedAt}).`,
          `Restored: ${b.chat.threads.length} chat threads, ${b.apiGroups.length} API groups (without keys), knowledge ${b.knowledge ? `${b.knowledge.docs.length} docs` : "skipped"}.`,
          "She needs to re-enter her API keys (they are never stored in backups).",
        ].join("\n");
      },
    },
    {
      name: "backup_status",
      description:
        "Check backup status: when the last backup was made and which backup files exist on this device. Use when she asks '上次备份是什么时候' or before suggesting a restore.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "backup",
      run: async () => {
        const lastAt = await getLastBackupAt(deps.kv);
        const files = await deps.listBackupFiles().catch(() => []);
        const lines = [`Last backup: ${lastAt ?? "never"}.`];
        if (files.length === 0) {
          lines.push("No backup files saved on this device.");
        } else {
          lines.push(
            `Saved backup files (${files.length}):`,
            ...files.slice(0, 5).map((f) => `- ${f.name}`),
          );
        }
        return lines.join("\n");
      },
    },
  ];
}
