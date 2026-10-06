/**
 * Personality evolution （性格进化） — prompt section builder + distill
 * cadence. PURE module: no React Native / expo imports, no I/O.
 *
 * The section is small and budgeted: newest notes first, capped count,
 * each line carrying its source citation so the model can see the
 * provenance of what it "learned".
 */

import type { EvolutionNote } from "./types";

const SECTION_BUDGET = 800;
const MAX_NOTES = 5;

/** One week between "review what you've learned" hints. Conservative. */
export const DISTILL_HINT_INTERVAL_MS = 7 * 24 * 3_600_000;

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * True when the AI hasn't distilled patterns in a while — the prompt may
 * carry a one-line nudge. The MODEL still decides whether a real pattern
 * exists; the gate only prevents nagging.
 */
export function shouldDistillHint(lastDistilledAt: number, nowMs: number): boolean {
  return nowMs - lastDistilledAt >= DISTILL_HINT_INTERVAL_MS;
}

/**
 * Build the "what I've learned about us" section for the system prompt.
 * Returns "" when disabled / incognito / no notes: no noise.
 */
export function buildEvolutionSection(
  notes: EvolutionNote[],
  opts: { personaName: string; enabled: boolean; lastDistilledAt: number; nowMs: number },
): string {
  if (!opts.enabled) return "";
  const lines: string[] = [];
  const shown = notes.slice(0, MAX_NOTES);
  if (shown.length > 0) {
    lines.push(
      "What you have learned about being with her (real, each cites its source — behave accordingly, don't recite this list):",
    );
    for (const n of shown) {
      const src = n.source.kind === "manual" ? "她亲口说的" : n.source.ref;
      lines.push(`- ${n.content}（${fmtDate(n.source.dateMs)}，${src}）`);
    }
  }
  if (shouldDistillHint(opts.lastDistilledAt, opts.nowMs)) {
    lines.push(
      "It's been a while since you reviewed what you've learned about her. If you notice a REPEATED pattern across days (not a one-off), write one evolution_note_add with its source citation. If nothing stands out, stay quiet.",
    );
  }
  if (lines.length === 0) return "";
  let section = lines.join("\n");
  if (section.length > SECTION_BUDGET) {
    const cut = section.lastIndexOf("\n", SECTION_BUDGET - 3);
    section = `${section.slice(0, cut > 0 ? cut : SECTION_BUDGET - 3)}...`;
  }
  return section;
}
