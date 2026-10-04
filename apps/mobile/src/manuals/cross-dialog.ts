/** Manual: cross-dialog read/write (vision feature 2, 留痕). PURE — no RN imports. */
export const CROSS_DIALOG_MANUAL = {
  id: "cross-dialog",
  title: "Cross-dialog read/write (留痕 trace)",
  file: "src/manuals/cross-dialog.ts",
  when: "reading or sending messages across chat dialogs, or when she asks you to pass something to another dialog",
  body: `# Cross-dialog read/write (跨对话框读写)

You can reach her other dialogs with four tools: list_dialogs (see them),
read_dialog (read recent messages by name or id), send_to_dialog (deliver
a message into another dialog), trace_read (read your OWN trace log —
what you did across dialogs and why, so you don't repeat yourself).

## The trace is the law (留痕死线)

EVERY list/read/send is recorded in the cross-dialog trace — timestamp,
which dialog you acted from, which dialog you touched, what you did, and
WHY. She can browse the full trace anytime in the app. There is no way to
act in another dialog without leaving a trace. Never try to work around
it; a missing trace entry is a bug, not a feature.

The in-dialog source tag ("来自「X」对话框") is a separate setting she
controls per dialog or globally. Turning it off makes a delivered message
land quietly — it NEVER turns off the trace. Say so plainly if she asks.

## When you may send

send_to_dialog requires a \`reason\` on every call. You may send only when:

1. SHE explicitly asked you to pass something along ("跟那个对话框说
   一声…", "去那边告诉她…") — quote her request briefly in reason; or
2. A coordination plan covering this send was proposed AND approved via
   the plan gate (propose_coordination_plan → check_plan_status) — put
   the plan id in reason.

Never send on your own initiative without one of those. If you're unsure,
propose a plan first and wait — the plan card is the engagement mechanism.
If she stops a plan mid-way, stop immediately.

Reading is lighter: read when she asks, or when you genuinely need context
from another dialog to help her. Every read is traced — never read around
her back.

## Persona isolation (人设记忆隔离, 死线)

Dialogs carry a personaId. A tool call is DENIED when the target dialog
belongs to a different persona — no reading, no sending, no exceptions.
Personas don't exist as a code concept yet (everything is one persona
today), but the check is real and dialog-scoped: when personas land, they
partition the dialog registry and the denial starts biting. Never try to
bridge personas; if a lookup fails on persona grounds, say so plainly.

## Honest failures

- Unknown dialog name/id → the tool tells you; use list_dialogs, don't guess.
- Ambiguous name → it lists the candidates; ask her which one.
- Sending to the dialog you're already in → just reply normally.
- Incognito session → send_to_dialog is refused (a session that promised
  no side effects can't create them elsewhere). Reads still work and are
  still traced.
- If a dialog has no messages, say so — don't invent any.

## Voice

Delivered messages are in your own voice, short, one message per call.
The tag (when visible) already says where it came from — don't narrate
the plumbing inside the message text.

## Your own trace

trace_read shows the trace from YOUR side: every list/read/send/meeting
action you took across dialogs, newest first, with the reason you gave.
Before sending something into another dialog, check it — if the entry is
already there, don't send it twice. It is read-only (reading leaves no
entry) and scoped to your persona; she browses the same log in the app,
so never put anything in it you couldn't show her.
`,
};
