/**
 * Personality evolution （性格进化） — types. PURE module: no React Native /
 * expo imports.
 *
 * The gap (romance-gap ⑦): Nomi/Kindroid/筑梦岛 evolve with the user — the
 * AI visibly deepens over time. Dudu has memory + persona cards, but the
 * persona itself never changed.
 *
 * Design: the AI distills PATTERNS (never single events) from memory +
 * conversation — "she lights up when I tease her", "she goes quiet when
 * I'm too clingy" — into evolution notes, one persona per note set.
 * Notes ride the system prompt as a small "what I've learned about us"
 * section, so behavior REALLY changes. Everything is visible to her:
 * Our Space → 成长记录 shows every note (read/edit/delete), plus a master
 * toggle and a reset back to the card baseline.
 *
 * Hard rules (her decisions):
 * - Every note cites its source (date + conversation ref). The AI must
 *   never claim a false memory — no source, no note.
 * - Safety line: evolution adapts the AI to HER (tone, pacing, what
 *   delights her). It never steers her emotions or creates dependency.
 *   Documented in the manual.
 * - Persona isolation: notes never leak across personas.
 * - Incognito: write tools blocked (INCOGNITO_BLOCKED_TOOLS); the
 *   evolution section never rides an incognito prompt.
 */

/** Where a note came from — the anti-gaslighting citation. */
export interface EvolutionSource {
  /** "chat" = a conversation, "manual" = she told him directly / he wrote it by hand. */
  kind: "chat" | "manual";
  /** When the pattern was observed (unix ms). Required. */
  dateMs: number;
  /** Conversation reference: dialog name/date or a short excerpt id. Required, non-empty. */
  ref: string;
}

/** One evolution note: a distilled pattern about how to be with her. */
export interface EvolutionNote {
  id: string;
  /** The persona this note belongs to. Never shown to other personas. */
  personaId: string;
  /** The pattern, one crisp sentence, e.g. "她被逗的时候会开心，多逗她". */
  content: string;
  /** The citation that proves this happened. */
  source: EvolutionSource;
  createdAt: number;
  updatedAt: number;
}

export function newEvolutionNoteId(nowMs: number = Date.now()): string {
  return `ev_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Validate a note payload. Returns error message or null (valid). */
export function validateEvolutionNote(input: {
  personaId?: unknown;
  content?: unknown;
  source?: unknown;
}): string | null {
  if (typeof input.personaId !== "string" || input.personaId.trim().length === 0) {
    return "personaId is required.";
  }
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    return "content is required — one crisp pattern, not a novel.";
  }
  if (input.content.trim().length > 200) {
    return "content must be 200 characters or fewer.";
  }
  const s = input.source;
  if (!isRecord(s)) return "source is required — every note cites its source.";
  if (s.kind !== "chat" && s.kind !== "manual") {
    return 'source.kind must be "chat" or "manual".';
  }
  if (typeof s.dateMs !== "number" || !Number.isFinite(s.dateMs) || s.dateMs <= 0) {
    return "source.dateMs is required — when the pattern was observed.";
  }
  if (typeof s.ref !== "string" || s.ref.trim().length === 0) {
    return "source.ref is required — which conversation / where it happened.";
  }
  return null;
}

/** Shape-check a stored note; null = drop the row. */
export function sanitizeEvolutionNote(v: unknown): EvolutionNote | null {
  if (!isRecord(v)) return null;
  const { id, personaId, content, source, createdAt, updatedAt } = v;
  if (typeof id !== "string" || typeof personaId !== "string" || typeof content !== "string") {
    return null;
  }
  if (!isRecord(source)) return null;
  const { kind, dateMs, ref } = source;
  if (kind !== "chat" && kind !== "manual") return null;
  if (typeof dateMs !== "number" || typeof ref !== "string") return null;
  const nowC = typeof createdAt === "number" ? createdAt : 0;
  return {
    id,
    personaId,
    content,
    source: { kind, dateMs, ref },
    createdAt: nowC,
    updatedAt: typeof updatedAt === "number" ? updatedAt : nowC,
  };
}
