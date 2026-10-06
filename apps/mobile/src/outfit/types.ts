/**
 * Outfit / dress-up system （换装系统） — types. PURE module: no React
 * Native / expo imports, no I/O.
 *
 * A wardrobe belongs to ONE persona (persona isolation: personaA's
 * outfits never leak to personaB). Each outfit is a named look with an
 * English prompt fragment — the active outfit flows into the persona's
 * generated-photo prompts (photoshare selfies, generate_image drawings
 * of the persona) at the prompt level.
 *
 * Honest scope (also stated in manuals/outfit.ts): this is NOT
 * paper-doll rendering. The image backends take text prompts only, so
 * outfit accuracy is prompt-level consistency, same as the character
 * reference. A static uploaded persona avatar is NOT redrawn by an
 * outfit change.
 */

/** One outfit in a persona's wardrobe. */
export interface Outfit {
  id: string;
  personaId: string;
  /** Display name in her language, e.g. "奶油白卫衣". */
  name: string;
  /**
   * English prompt fragment for the image model, e.g.
   * "oversized cream sweater, plaid skirt, white socks".
   */
  description: string;
  /** Optional reference image (local path or URL). */
  refImageUri?: string;
  /** Who added it: her, or the AI ("bought"/imagined it for her). */
  createdBy: "her" | "ai";
  createdAt: number;
  updatedAt: number;
}

/** One persona's wardrobe: the outfit list + which one is worn. */
export interface Wardrobe {
  outfits: Outfit[];
  /** Active outfit id, or null = no outfit set. */
  activeId: string | null;
}

export const OUTFIT_NAME_MAX = 40;
export const OUTFIT_DESCRIPTION_MAX = 300;

export function newOutfitId(nowMs: number = Date.now()): string {
  return `outfit_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate outfit input. Returns an error message or null if valid. */
export function validateOutfitInput(input: {
  name?: unknown;
  description?: unknown;
}): string | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name) return "name-required";
  if (name.length > OUTFIT_NAME_MAX) return "name-too-long";
  if (!description) return "description-required";
  if (description.length > OUTFIT_DESCRIPTION_MAX) return "description-too-long";
  return null;
}

/** Blank wardrobe for a persona that has none yet. */
export function blankWardrobe(): Wardrobe {
  return { outfits: [], activeId: null };
}
