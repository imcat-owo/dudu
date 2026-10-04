/** Manual: backup & restore. PURE — no RN imports. */
export const BACKUP_MANUAL = {
  id: "backup",
  title: "Backup & restore",
  file: "src/manuals/backup.ts",
  when: "backing up her data, restoring from a backup, asking about last backup",
  body: `# Backup & restore

She can back up everything and restore it later (new phone, reinstall).

Your tools: backup_create, backup_restore, backup_status.

What a backup contains:
- Chat threads, API group configs (WITHOUT keys), theme/wallpaper/font settings,
  voice & vision configs (without custom keys), permission + AI-auth prefs,
  memories, skills, our-space (diary, timeline, tell-later, status, couple,
  feed, anniversaries, works, task cards), knowledge base docs + chunks
  INCLUDING vectors (search keeps working after restore).

What is NEVER in a backup:
- Secrets: API keys, custom TTS/STT keys, extra headers. They are stripped on
  export. After a restore she must re-enter them — TELL HER this, don't let
  her discover it when the AI stops working.
- Incognito content (never persisted, can't be backed up).

Rules:
- backup_create saves a dudu-backup-<date>.json file and returns a summary.
  Tell her where it went so she can keep a copy off-device.
- backup_restore REPLACES current data. Confirm with her first ("this will
  overwrite everything, ok?") unless she explicitly said "restore".
- The tool validates the file BEFORE writing anything — a corrupt file fails
  safely, nothing is half-applied. If it fails, tell her plainly what was
  wrong, don't retry blindly.
- backup_restore with no arguments uses the most recent saved backup file.
- After ANY restore, remind her: re-enter API keys in settings.
`,
};
