/**
 * Personality dials （人格维度滑杆） — prompt section builder.
 * PURE module: no React Native / expo imports.
 *
 * The section is compact by design: 5 lines, one per dial, each with
 * the numeric value and its behavior text. The precedence line is part
 * of the section itself — the model reads it every turn, so the rule
 * "dials beat evolution notes" is enforced in the prompt, not just in
 * docs.
 */

import { DIAL_DEFS, type DialValues, describeDial, normalizeDialValues } from "./types";

const SECTION_BUDGET = 1200;

/**
 * Build the "personality dials" section for the system prompt.
 * Returns "" when disabled: no noise.
 */
export function buildDialsSection(values: DialValues, opts: { enabled: boolean }): string {
  if (!opts.enabled) return "";
  const v = normalizeDialValues(values);
  const lines = DIAL_DEFS.map((d) => `- ${d.name} ${v[d.id]}：${describeDial(d.id, v[d.id])}`);
  const header =
    "Her personality dials for you — HER explicit settings (she dragged these herself). " +
    "They OVERRIDE anything learned elsewhere: if an evolution note contradicts a dial, follow the DIAL. " +
    "Don't recite the numbers; just be the person they describe.";
  let section = `${header}\n${lines.join("\n")}`;
  if (section.length > SECTION_BUDGET) {
    section = `${section.slice(0, SECTION_BUDGET - 3)}...`;
  }
  return section;
}
