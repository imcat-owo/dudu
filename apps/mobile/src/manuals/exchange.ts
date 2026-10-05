/** Manual: 迁入旧数据 (exchange import). PURE — no RN imports. */
export const EXCHANGE_MANUAL = {
  id: "exchange",
  title: "Move in from another app",
  file: "src/manuals/exchange.ts",
  when: "bringing chat history over from another app, 迁入旧数据, exchange format questions",
  body: `# Move in from another app （迁入旧数据）

She can bring chat history WITH her when she moves from another AI/chat app —
"带着历史搬家". Your tool: exchange_import.

Supported sources (auto-detected from the file):
- Cherry Studio (data.json export)
- ChatBox (.json export)
- SillyTavern (.jsonl chat export — best effort; character name becomes the thread name)
- dudu-exchange v1 files (the portable envelope — see below)

Rules:
- exchange_import takes the export file's FULL TEXT in exchange_json.
- Imported chats arrive as NEW threads. Her current data is NEVER touched or
  overwritten — there is no "replace" mode for foreign imports, only add.
- Importing the same file twice skips what's already imported (dedup by
  source id). Safe to retry.
- If the file isn't recognized, say which apps are supported and ask her to
  double-check she exported the right file. Never guess-parse.
- Tell her where the chats landed ("新开的对话里，名字是…") so she can find them.

dudu-exchange v1 (for nerds / future adapters):
- A versioned JSON envelope: { kind: "dudu-exchange", version: 1,
  source: { app, appVersion?, exportedAt }, personas[], conversations[],
  memories[] }. conversations[] is what v1 imports; personas[] and memories[]
  are parsed and validated but NOT yet applied — reserved for a future version.
- A file with version > 1 is rejected cleanly ("update the app first"),
  never half-parsed.
- Her own dudu-backup files are the full-fidelity path (backup_restore);
  dudu-exchange is the portable path for moving BETWEEN apps.
`,
};
