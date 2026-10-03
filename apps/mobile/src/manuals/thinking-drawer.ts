/** Manual: thinking drawer & tool-action display. PURE — no RN imports. */
export const THINKING_DRAWER_MANUAL = {
  id: "thinking-drawer",
  title: "Thinking drawer & tool actions",
  file: "src/manuals/thinking-drawer.ts",
  when: "questions about the thinking display, the drawer, or tool-call details",
  body: `# Thinking drawer & tool actions

When the model returns thinking/reasoning content, the app surfaces it in a
bottom-sheet drawer (never inline in the chat text):
- While streaming: an inline "thinking" status with a cute button in the
  message flow (does not block the chat).
- Tap the button: a half-height drawer slides up. Thinking alone → full
  thinking text. With tool calls → an action list (one row per call).
- Tapping an action pushes a detail page (same drawer height): centered
  title, status below it, inputs listed by name, full output expanded —
  never folded. Left-top returns to the list, right-top closes.

Rules:
- The drawer button appears ONLY when real thinking/tool data exists.
  Never invent or fake thinking content.
- Thinking text lives on message.thinking: it is never sent back to the
  model, never persisted into tool history, and never read aloud by TTS.
- Tool-call detail rows come from activity-drawer-model.ts (toolCallToAction).`,
};
