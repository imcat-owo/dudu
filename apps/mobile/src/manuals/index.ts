/**
 * 纸条机制 — proactive manual-note system.
 *
 * How it works (token-minimal by design):
 * 1. The registry below maps feature -> { manual file, one-line "when" }.
 *    buildManualIndex() renders it as ~10 compact lines injected into every
 *    system prompt. THIS is the proactive note — the system slips it to the
 *    AI on every turn, always visible, tiny.
 * 2. The AI is instructed: unsure -> call read_manual("<id>") BEFORE acting;
 *    already know it -> don't read, save the tokens.
 * 3. On-demand: the read_manual tool returns the full manual body.
 * 4. Safety net: when a tool call FAILS, the agent appends a one-line note
 *    pointing at that tool's manual (unless already read this turn).
 *
 * Triggering is semantic, not keyword-locked: the MODEL reads the index and
 * decides relevance itself. No brittle keyword lists, no fake "AI".
 * (True embedding-based retrieval would need on-device vectors — overkill
 * for 8 manuals; the model + index does the job honestly.)
 *
 * PURE module: no React Native / expo imports — unit-testable in node.
 * Adding a manual = one file in this dir + one entry in MANUALS below.
 */

import { API_GROUPS_MANUAL } from "./api-groups.js";
import { INCOGNITO_MANUAL } from "./incognito.js";
import { MCP_TOOLS_MANUAL } from "./mcp-tools.js";
import { MEMORY_MANUAL } from "./memory.js";
import { OUR_SPACE_MANUAL } from "./our-space.js";
import { PERMISSIONS_MANUAL } from "./permissions.js";
import { SANDBOX_MANUAL } from "./sandbox.js";
import { THEMES_MANUAL } from "./themes.js";
import { THINKING_DRAWER_MANUAL } from "./thinking-drawer.js";
import { VISION_MANUAL } from "./vision.js";
import { VOICE_MANUAL } from "./voice.js";

export interface ManualEntry {
  /** Stable id, used by read_manual. */
  id: string;
  /** Human title. */
  title: string;
  /** Canonical file path — what the note points at. */
  file: string;
  /** One line, written FOR the AI: when this manual is relevant. */
  when: string;
  /** Full manual body (markdown). */
  body: string;
}

export const MANUALS: ManualEntry[] = [
  PERMISSIONS_MANUAL,
  MCP_TOOLS_MANUAL,
  THINKING_DRAWER_MANUAL,
  INCOGNITO_MANUAL,
  VOICE_MANUAL,
  VISION_MANUAL,
  THEMES_MANUAL,
  API_GROUPS_MANUAL,
  SANDBOX_MANUAL,
  OUR_SPACE_MANUAL,
  MEMORY_MANUAL,
];

export function getManual(id: string): ManualEntry | undefined {
  return MANUALS.find((m) => m.id === id);
}

export function manualIds(): string[] {
  return MANUALS.map((m) => m.id);
}

/**
 * Token-minimal index for the system prompt — the proactive note itself.
 * One line per manual: id, when, file. Stays tiny on purpose.
 */
export function buildManualIndex(): string {
  return MANUALS.map((m) => `- ${m.id}: ${m.when} — ${m.file}`).join("\n");
}

/**
 * One-line proactive note appended to tool errors (unless already read).
 * Returns "" for unknown ids — never fakes a manual.
 */
export function manualNote(id: string): string {
  const m = getManual(id);
  if (!m) return "";
  return `[note: ${m.file} is the manual for ${m.title}]`;
}
