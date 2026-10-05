/**
 * Backup & restore AI tools — let her trigger backup/restore by voice.
 * "凡事儿我能对他喊话，他能做到的，都能在对话框里完成。"
 *
 * PURE module: no React Native imports. File I/O, knowledge store access,
 * and post-restore store refreshes are injected via BackupToolDeps; the
 * real wiring lives in local-agent.ts.
 */

import type { LocalTool } from "./api-groups/local-tools";
import { ToolError } from "./api-groups/local-tools";
import {
  applyBackup,
  collectBackup,
  getLastBackupAt,
  type KeyValueStore,
  type KnowledgeBackupTarget,
  markBackedUp,
  parseBackup,
  type RestoreMode,
  type SecureKV,
  serializeBackup,
} from "./backup";
import { importExchange } from "./exchange/import";

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
  /** Refresh in-memory store mirrors after a restore (theme, voice, memory, …).
   * Returns true when the restored theme bundle was re-applied immediately
   * (false = no theme UI mounted; the stored bundle applies on next launch). */
  onRestored: () => Promise<boolean>;
  /**
   * Optional: collect her voice message recordings as filename → base64.
   * Absent = this build can't read them; backup skips them honestly. (P2-5)
   */
  collectVoiceFiles?: () => Promise<Record<string, string>>;
  /**
   * Optional: write restored voice files back to stable storage and rewrite
   * their URIs inside chat messages. Returns the number of files restored.
   */
  restoreVoiceFiles?: (files: Record<string, string>) => Promise<number>;
}

function summarize(backup: {
  exportedAt: string;
  chat: { threads: Array<{ id: string }> };
  apiGroups: unknown[];
  secretsExcluded: {
    apiKeys: number;
    ttsKeys: number;
    sttKeys: number;
    headersExcluded: number;
    urlsSanitized: number;
  };
  knowledge?: { docs: unknown[]; chunks: unknown[] };
  memories?: Record<string, unknown>;
  skills?: Record<string, unknown>;
  ourSpace?: Record<string, unknown>;
}): string {
  const se = backup.secretsExcluded;
  const lines = [
    `Backup created at ${backup.exportedAt}.`,
    `Chat threads: ${backup.chat.threads.length}.`,
    `API groups: ${backup.apiGroups.length} (keys excluded: ${se.apiKeys}, custom headers excluded: ${se.headersExcluded}).`,
  ];
  if (se.urlsSanitized > 0) {
    lines.push(
      `${se.urlsSanitized} config URL(s) had secret-looking query params (?key=, ?token=, …) removed on export — the backed-up baseUrl differs from the original. Check them after a restore.`,
    );
  }
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
    "Secrets (API keys, custom request headers, custom voice keys) were NOT backed up — she will need to re-enter them after a restore.",
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
        "Create a full backup of her app data (chat threads, API group configs WITHOUT keys, theme, voice settings, app settings, memories, skills, our-space incl. diary/timeline/anniversaries/task cards, knowledge base docs+vectors, her voice message recordings). Use when she says '备份一下' / '帮我备份'. The backup is saved to a file; secrets (API keys, custom request headers, custom voice keys) are never included. Returns a summary of what was backed up.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "backup",
      run: async () => {
        const knowledge = await deps.getKnowledgeStore().catch(() => null);
        const backup = await collectBackup(deps.kv, deps.secure, knowledge);
        // P2-5: her voice message recordings are irreplaceable — include them.
        let voiceFileCount = 0;
        if (deps.collectVoiceFiles) {
          try {
            backup.voiceMessages = await deps.collectVoiceFiles();
            voiceFileCount = Object.keys(backup.voiceMessages).length;
          } catch {
            // backup proceeds without them; never fail the whole backup
          }
        }
        const json = serializeBackup(backup);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `dudu-backup-${stamp}.json`;
        const savedHint = await deps.saveBackupFile(filename, json);
        await markBackedUp(deps.kv);
        const summary = summarize(backup);
        return voiceFileCount > 0
          ? `${summary}\nVoice message recordings: ${voiceFileCount} included.\nSaved: ${savedHint}`
          : `${summary}\nSaved: ${savedHint}`;
      },
    },
    {
      name: "backup_restore",
      description:
        "Restore app data from a backup. Use when she says '恢复备份' / '把数据恢复回来'. Either pass the backup JSON text directly in backup_json, or leave it empty to restore the most recent backup file saved on this device. The backup is validated BEFORE anything is written — a corrupt file fails safely without touching her data. After restore, API keys must be re-entered (they are never in backups). mode: 'overwrite' (default) replaces everything — confirm with her first unless she explicitly asked; 'merge' only adds what's missing and keeps current data.",
      parameters: {
        type: "object",
        properties: {
          backup_json: {
            type: "string",
            description:
              "Full text of a dudu-backup JSON file. Optional — when omitted, the most recent saved backup file is used.",
          },
          mode: {
            type: "string",
            enum: ["overwrite", "merge"],
            description:
              "Restore mode. 'overwrite' replaces all current data (confirm with her first). 'merge' only adds missing items and keeps her current data.",
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
        const rawMode = args.mode;
        const mode: RestoreMode = rawMode === "merge" ? "merge" : "overwrite";
        await applyBackup(parsed.backup, deps.kv, deps.secure, knowledge, { mode });
        const themeApplied = await deps.onRestored();
        // P2-5: restore her voice recordings and re-point message URIs at
        // this device's stable directory, so old voice bubbles keep playing.
        let voiceRestored = 0;
        if (parsed.backup.voiceMessages && deps.restoreVoiceFiles) {
          try {
            voiceRestored = await deps.restoreVoiceFiles(parsed.backup.voiceMessages);
          } catch {
            // restore of other data already succeeded; don't fail it here
          }
        }
        const b = parsed.backup;
        const se = b.secretsExcluded;
        const out = [
          `Restore complete from ${source} (exported at ${b.exportedAt}, mode: ${mode}).`,
          `Restored: ${b.chat.threads.length} chat threads, ${b.apiGroups.length} API groups (without keys), knowledge ${b.knowledge ? `${b.knowledge.docs.length} docs` : "skipped"}.`,
          voiceRestored > 0
            ? `Voice message recordings restored: ${voiceRestored}.`
            : b.voiceMessages
              ? "Voice message recordings were in the backup but couldn't be restored on this device."
              : "No voice message recordings in this backup.",
          themeApplied
            ? "Theme re-applied from the backup."
            : "Theme settings restored — they apply on next app launch.",
          "She needs to re-enter her API keys and any custom request headers (they are never stored in backups).",
        ];
        if (se.urlsSanitized > 0) {
          out.push(
            `Note: ${se.urlsSanitized} API group URL(s) had secret query params stripped on export — double-check those baseUrls in settings.`,
          );
        }
        return out.join("\n");
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
    {
      name: "exchange_import",
      description:
        "Import chat history from ANOTHER app's export file (Cherry Studio, ChatBox, SillyTavern, or a dudu-exchange v1 file). Use when she says '把我在别家的聊天记录搬进来' / '迁入旧数据'. Pass the export file's full text in exchange_json. The source is auto-detected; imported chats arrive as NEW threads — her current data is never touched or overwritten, and importing the same file twice skips what's already imported.",
      parameters: {
        type: "object",
        properties: {
          exchange_json: {
            type: "string",
            description: "Full text of the other app's export file (JSON or JSONL). Required.",
          },
        },
        required: ["exchange_json"],
        additionalProperties: false,
      },
      manualId: "exchange",
      run: async (args) => {
        const text = strArg(args, "exchange_json").trim();
        if (!text) {
          throw new ToolError(
            "No exchange_json provided. Ask her for the other app's export file.",
          );
        }
        const outcome = await importExchange(text, deps.kv);
        if (!outcome.ok) {
          const hints: Record<string, string> = {
            empty: "The file is empty.",
            "not-json": "Not a valid file.",
            "bad-kind": "Not a dudu-exchange file.",
            "unsupported-version":
              "Exchange file is from a newer format version — update the app first.",
            "invalid-shape": "Exchange file is corrupt.",
            "unknown-source":
              "Couldn't recognize which app this export came from. Supported: Cherry Studio, ChatBox, SillyTavern, dudu-exchange v1.",
            "import-invalid-json": "The export file is corrupt.",
            "import-no-conversations": "No importable chats found in this file.",
          };
          throw new ToolError(
            `Import failed: ${hints[outcome.code] ?? outcome.code}${outcome.detail ? ` ${outcome.detail}` : ""} Nothing was changed.`,
          );
        }
        const { result, adapter } = outcome;
        const lines = [
          `Imported from ${adapter.appName}: ${result.conversations} chats, ${result.messages} messages — added as new threads, current data untouched.`,
        ];
        if (result.skipped > 0) {
          lines.push(`${result.skipped} already imported, skipped.`);
        }
        return lines.join("\n");
      },
    },
  ];
}
