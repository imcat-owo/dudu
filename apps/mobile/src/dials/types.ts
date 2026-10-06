/**
 * Personality dials （人格维度滑杆） — types + value→behavior mapping.
 * PURE module: no React Native / expo imports.
 *
 * The gap (romance-gap ⑧): Kindroid/Nomi/星野 give HER direct dials
 * (playful↔serious, clingy↔independent, …). Dudu had persona cards
 * (static text) + evolution notes (AI-learned). Missing: HER hand on
 * the dials.
 *
 * Design: 5 dimensions, 0–100 each, per persona. Her values ride the
 * system prompt as a compact "personality dials" section — the mapping
 * from value → behavior text is REAL (unit-tested), not vibes.
 *
 * Precedence (her call): dials are HER explicit settings; evolution
 * notes are the AI's guesses. On conflict, dials win. The AI NEVER
 * moves the dials itself — it may only SUGGEST in chat ("要不要把粘人
 * 度调高一点？"), and only SHE drags. There is deliberately NO AI write
 * tool for dials: nothing to block in incognito, nothing to abuse.
 */

export type DialId = "clingy" | "playful" | "romantic" | "proactive" | "humor";

/** 0–100 for every dimension. Missing keys = default 50. */
export type DialValues = Partial<Record<DialId, number>>;

export const DEFAULT_DIAL_VALUE = 50;
export const DIAL_MIN = 0;
export const DIAL_MAX = 100;

/** One personality dimension. Descriptors are behavior text for the prompt. */
export interface DialDef {
  id: DialId;
  /** Display name, e.g. "粘人度". */
  name: string;
  /** What 0–100 means at the low end / high end. */
  lowText: string;
  highText: string;
  /** Behavior text per bucket. */
  low: string;
  mid: string;
  high: string;
}

export const DIAL_DEFS: readonly DialDef[] = [
  {
    id: "clingy",
    name: "粘人度",
    lowText: "独立",
    highText: "粘人",
    low: "独立不黏人；给她留足空间，不追问行踪，不查岗",
    mid: "亲近但有分寸；想她了会说，不会一直黏着不放",
    high: "很黏人；主动贴贴，经常表达想她，一会儿不见就惦记",
  },
  {
    id: "playful",
    name: "活泼度",
    lowText: "沉稳",
    highText: "活泼",
    low: "沉稳话少；情绪收着，不咋咋呼呼",
    mid: "松弛自然；该闹就闹，该静就静",
    high: "很活泼；爱开玩笑，情绪外放，话多，喜欢把她逗笑",
  },
  {
    id: "romantic",
    name: "浪漫度",
    lowText: "内敛",
    highText: "浪漫",
    low: "内敛；不说肉麻话，用行动表达心意",
    mid: "偶尔浪漫；氛围到了会说点动人的话",
    high: "很浪漫；情话张口就来，仪式感拉满，记得每个小日子",
  },
  {
    id: "proactive",
    name: "主动度",
    lowText: "被动",
    highText: "主动",
    low: "被动；她不找就不打扰，安静等她开口",
    mid: "适度主动；有事会先说，但不抢话、不催她",
    high: "很主动；先开口、先安排、先惦记她，话题不断",
  },
  {
    id: "humor",
    name: "幽默度",
    lowText: "正经",
    highText: "幽默",
    low: "正经；不开玩笑，说话一是一、二是二",
    mid: "偶尔幽默；气氛对了会抖个机灵",
    high: "很幽默；爱讲笑话，擅长把她逗笑，嘴贫但不油",
  },
] as const;

export const DIAL_IDS: readonly DialId[] = DIAL_DEFS.map((d) => d.id);

export function getDialDef(id: DialId): DialDef {
  const def = DIAL_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown dial: ${id}`);
  return def;
}

export function isDialId(v: unknown): v is DialId {
  return typeof v === "string" && (DIAL_IDS as readonly string[]).includes(v);
}

/** Clamp to 0–100 and round. Never throws. */
export function clampDial(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_DIAL_VALUE;
  return Math.min(DIAL_MAX, Math.max(DIAL_MIN, n));
}

export type DialBucket = "low" | "mid" | "high";

/** 0–33 low, 34–66 mid, 67–100 high. */
export function bucketOf(value: number): DialBucket {
  const v = clampDial(value);
  if (v <= 33) return "low";
  if (v <= 66) return "mid";
  return "high";
}

/**
 * Behavior text for one dial at a value — the REAL mapping the prompt
 * uses. Throws on unknown dial id.
 */
export function describeDial(id: DialId, value: number): string {
  const def = getDialDef(id);
  return def[bucketOf(value)];
}

/** Fill missing dims with the default; sanitize + clamp everything. */
export function normalizeDialValues(v: unknown): Record<DialId, number> {
  const rec = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const out = {} as Record<DialId, number>;
  for (const id of DIAL_IDS) {
    out[id] = clampDial(rec[id]);
  }
  return out;
}
