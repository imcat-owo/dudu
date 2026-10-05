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

import { API_GROUPS_MANUAL } from "./api-groups";
import { BACKUP_MANUAL } from "./backup";
import { BROWSER_MANUAL } from "./browser";
import { COORDINATION_MANUAL } from "./coordination";
import { CROSS_DIALOG_MANUAL } from "./cross-dialog";
import { GROUP_MEETING_MANUAL } from "./group-meeting";
import { INCOGNITO_MANUAL } from "./incognito";
import { INITIATIVE_MANUAL } from "./initiative";
import { KNOWLEDGE_MANUAL } from "./knowledge";
import { MCP_TOOLS_MANUAL } from "./mcp-tools";
import { MEDIA_MANUAL } from "./media";
import { MEMORY_MANUAL } from "./memory";
import { MUSIC_ROOM_MANUAL } from "./music-room";
import { NATIVE_APPS_MANUAL } from "./native-apps";
import { OPEN_APP_MANUAL } from "./openapp";
import { OUR_SPACE_MANUAL } from "./our-space";
import { OUTREACH_MANUAL } from "./outreach";
import { PERMISSIONS_MANUAL } from "./permissions";
import { SANDBOX_MANUAL } from "./sandbox";
import { SKILLS_MANUAL } from "./skills";
import { THEMES_MANUAL } from "./themes";
import { THINKING_DRAWER_MANUAL } from "./thinking-drawer";
import { VISION_MANUAL } from "./vision";
import { VOICE_MANUAL } from "./voice";

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
  COORDINATION_MANUAL,
  CROSS_DIALOG_MANUAL,
  GROUP_MEETING_MANUAL,
  BROWSER_MANUAL,
  SANDBOX_MANUAL,
  OUR_SPACE_MANUAL,
  OUTREACH_MANUAL,
  INITIATIVE_MANUAL,
  MEMORY_MANUAL,
  MUSIC_ROOM_MANUAL,
  NATIVE_APPS_MANUAL,
  OPEN_APP_MANUAL,
  SKILLS_MANUAL,
  KNOWLEDGE_MANUAL,
  MEDIA_MANUAL,
  BACKUP_MANUAL,
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
