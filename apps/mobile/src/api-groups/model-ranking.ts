/**
 * 智商排行榜智能路由 (vision doc §1) — model ranking by 聪明 + 好用 + 快.
 *
 * This is a STATIC CURATED SNAPSHOT (2026-10), not live data. Scores are
 * relative editorial judgments (0-100), not benchmark runs. The paper-slip
 * says so openly, and the module notes the live-source candidates
 * (LMArena / Artificial Analysis / OpenRouter) for a future refresh.
 *
 * How the AI uses it: the ranking is injected into the system prompt as a
 * compact paper slip (see buildRankingSlip), NOT just a UI list. When the
 * AI picks a model — inside a capability group, or when she asks "换个更
 * 聪明的" — it consults this slip. Three modes reweight the axes:
 * balanced (均衡), smart-first (聪明优先), fast-first (速度优先).
 *
 * Entries match by regex against her configured model names, so the list
 * stays useful no matter which API groups she wires up. scoreModelName
 * returns null when nothing matches (neutral — her order wins).
 *
 * PURE module: no React Native / expo imports.
 */

export type RankingMode = "balanced" | "smart" | "fast";

export const RANKING_MODES: { id: RankingMode; labelZh: string; labelEn: string }[] = [
  { id: "balanced", labelZh: "均衡", labelEn: "Balanced" },
  { id: "smart", labelZh: "聪明优先", labelEn: "Smart first" },
  { id: "fast", labelZh: "速度优先", labelEn: "Fast first" },
];

/** Weight of [smart, useful, fast] per mode. */
const MODE_WEIGHTS: Record<RankingMode, [number, number, number]> = {
  balanced: [0.4, 0.4, 0.2],
  smart: [0.7, 0.2, 0.1],
  fast: [0.2, 0.3, 0.5],
};

export interface MatchRule {
  /**
   * Regex source that must match a FULL token segment of the normalized
   * name (separator-bounded: start/end or a non-alphanumeric). Vendor
   * qualification is REQUIRED here — "opus" alone must not match
   * "octopus-v1" (P2-7: unanchored substrings misranked unknowns as
   * "smartest" on the paper slip).
   */
  seg?: string;
  /**
   * Regex source that must match the ENTIRE normalized name. Only for
   * short names she might type by hand ("opus", "flash") — never for
   * bare capability tokens inside longer names ("my-flash-model" must
   * stay unknown).
   */
  exact?: string;
}

export interface RankedModel {
  /**
   * Match rules, tried in order. First matching entry wins — the list is
   * ordered most-specific first. Returns null when nothing matches: an
   * unknown model is NEVER presented as a ranked family.
   */
  match: MatchRule[];
  /** Display name shown on the paper slip. */
  name: string;
  /** 聪明 — relative reasoning/capability score, 0-100. */
  smart: number;
  /** 好用 — relative usefulness/follow-through score, 0-100. */
  useful: number;
  /** 快 — relative speed score, 0-100. */
  fast: number;
  /** One-line note for the slip. */
  note: string;
}

/**
 * Curated snapshot 2026-10. Family-level entries on purpose: exact model
 * versions churn monthly, families are stable. Scores are EDITORIAL and
 * RELATIVE (not benchmark numbers) — the slip says so.
 *
 * Refresh candidates (live sources): LMArena leaderboard, Artificial
 * Analysis, OpenRouter rankings. A future refresh job can replace
 * RANKED_MODELS wholesale; the scoring code doesn't care where it came from.
 */
export const RANKED_MODELS: RankedModel[] = [
  {
    match: [{ seg: "claude[\\d\\W]*opus" }, { exact: "opus" }],
    name: "Claude Opus 系",
    smart: 98,
    useful: 92,
    fast: 60,
    note: "最聪明，慢而贵",
  },
  { match: [{ seg: "gpt[\\d\\W]*5" }, { exact: "gpt-5" }], name: "GPT-5 系", smart: 96, useful: 92, fast: 70, note: "全能，略慢" },
  {
    match: [{ seg: "gemini[\\d\\W]*pro" }],
    name: "Gemini Pro 系",
    smart: 95,
    useful: 90,
    fast: 78,
    note: "聪明且快",
  },
  {
    match: [{ seg: "grok[\\d\\W]*(4|heavy)" }, { exact: "grok" }],
    name: "Grok 系",
    smart: 93,
    useful: 85,
    fast: 78,
    note: "强推理，个性直",
  },
  {
    match: [{ seg: "claude[\\d\\W]*sonnet" }, { exact: "sonnet" }],
    name: "Claude Sonnet 系",
    smart: 92,
    useful: 94,
    fast: 80,
    note: "最好用，均衡",
  },
  { match: [{ seg: "deepseek" }], name: "DeepSeek 系", smart: 90, useful: 82, fast: 86, note: "聪明便宜" },
  { match: [{ seg: "qwen" }], name: "Qwen 系", smart: 89, useful: 84, fast: 88, note: "中文好" },
  {
    match: [{ seg: "kimi|moonshot" }],
    name: "Kimi 系",
    smart: 88,
    useful: 86,
    fast: 85,
    note: "中文好，长文本",
  },
  {
    match: [{ seg: "gemini[\\d\\W]*flash" }, { exact: "flash" }],
    name: "Gemini Flash 系",
    smart: 84,
    useful: 88,
    fast: 96,
    note: "极快，够用",
  },
  {
    match: [{ seg: "gpt[\\d\\W]*mini" }, { exact: "mini" }],
    name: "GPT Mini 系",
    smart: 87,
    useful: 90,
    fast: 90,
    note: "快而稳",
  },
  { match: [{ seg: "llama" }], name: "Llama 系", smart: 85, useful: 80, fast: 90, note: "开源，可本地" },
];

export const RANKING_SNAPSHOT_DATE = "2026-10";
export const RANKING_SOURCES =
  "LMArena / Artificial Analysis / OpenRouter（候选实时源；当前为人工精选快照，可刷新）";

function findEntry(modelName: string): RankedModel | null {
  const name = (modelName ?? "").toLowerCase().trim();
  if (!name) return null;
  for (const e of RANKED_MODELS) {
    for (const rule of e.match) {
      try {
        // seg: full token segment only — "opus" must not match "octopus".
        // Digits/dots may ride inside (version numbers: "gemini-2.5-flash")
        // or right after the token ("qwen3-max"); letters may not.
        if (
          rule.seg &&
          new RegExp(`(?:^|[^a-z0-9])${rule.seg}(?:[0-9][0-9.]*)?(?:[^a-z0-9]|$)`, "i").test(name)
        )
          return e;
        // exact: the whole name, for short hand-typed names only.
        if (rule.exact && new RegExp(`^${rule.exact}$`, "i").test(name)) return e;
      } catch {
        // a bad pattern must never break routing
      }
    }
  }
  return null;
}

export function weightedScore(e: RankedModel, mode: RankingMode): number {
  const [ws, wu, wf] = MODE_WEIGHTS[mode];
  return e.smart * ws + e.useful * wu + e.fast * wf;
}

/**
 * Score her configured model name under a mode. Returns null when the
 * name matches nothing curated — callers treat null as neutral (keep her
 * configured order) rather than as zero.
 */
export function scoreModelName(modelName: string, mode: RankingMode): number | null {
  const e = findEntry(modelName);
  return e ? weightedScore(e, mode) : null;
}

/**
 * Order a list of model names best-first under a mode. Unknown names keep
 * their relative order at the end (stable, never punished).
 */
export function rankModelNames(names: string[], mode: RankingMode): string[] {
  const scored = names.map((n, i) => ({ n, i, s: scoreModelName(n, mode) }));
  scored.sort((a, b) => {
    if (a.s === null && b.s === null) return a.i - b.i;
    if (a.s === null) return 1;
    if (b.s === null) return -1;
    return b.s - a.s || a.i - b.i;
  });
  return scored.map((x) => x.n);
}

/**
 * Compact paper slip injected into the system prompt every turn.
 * Token-small on purpose: one section, top entries only, no fluff.
 * The AI reads it when choosing between models.
 */
export function buildRankingSlip(mode: RankingMode, topN = 8): string {
  const modeLabel = mode === "smart" ? "聪明优先" : mode === "fast" ? "速度优先" : "均衡";
  const ordered = [...RANKED_MODELS].sort(
    (a, b) => weightedScore(b, mode) - weightedScore(a, mode),
  );
  const lines = ordered.slice(0, topN).map((e, i) => {
    const s = Math.round(weightedScore(e, mode));
    return `${i + 1}.${e.name}(${e.smart}/${e.useful}/${e.fast})${s >= 90 ? "*" : ""}`;
  });
  return [
    `[模型情报 · ${modeLabel}模式 · ${RANKING_SNAPSHOT_DATE}人工精选快照，仅供参考]`,
    `综合排序：${lines.join(" ")}`,
    "读法：括号内=聪明/好用/快，* =综合90+。难题选聪明的，赶时间选快的；没上榜的模型按她配置的顺序用。",
    `候选实时源：${RANKING_SOURCES}`,
  ].join("\n");
}
