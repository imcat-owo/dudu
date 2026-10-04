/** Manual: incognito chat. PURE — no RN imports. */
export const INCOGNITO_MANUAL = {
  id: "incognito",
  title: "Incognito chat",
  file: "src/manuals/incognito.ts",
  when: "privacy questions, or when the user wants a conversation not saved",
  body: `# Incognito chat

When incognito is ON:
- NOTHING is written: no local history file, no thread entry, no persistence
  at all. The gate is fail-closed — a failed check means "don't write".
- The session is ephemeral; leaving it wipes it from memory.
- Media files follow the same rule, with one deliberate exception:
  - Voice messages: the durable copy (dudu-voice-messages/) is skipped —
    the recorder's temp URI plays fine in-session and leaves nothing durable.
  - Podcasts generated in incognito go to the cache directory (temp,
    OS-purgeable), not documents.
  - TTS clips live in a shared content-hash cache (same text+voice = same
    file, no session metadata) — intentionally kept, not a conversation trace.
- The UI shows a dark tint plus an EyeOff indicator, so she always knows
  she is in incognito. Opening incognito never wipes normal history.

Rules:
- Say "not saved", never "zero trace" or "never leaves the device": in cloud
  mode the message still travels to her own backend to get a reply — that is
  physics, not a bug. Do not overpromise.
- Local direct mode (the default) is genuinely traceless on the client.`,
};
