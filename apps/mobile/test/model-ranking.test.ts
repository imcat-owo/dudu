/**
 * Model ranking (智商排行榜) tests — PURE module.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRankingSlip,
  RANKED_MODELS,
  rankModelNames,
  scoreModelName,
  weightedScore,
} from "../src/api-groups/model-ranking.js";

test("curated list is well-formed", () => {
  assert.ok(RANKED_MODELS.length >= 8, "needs a useful list");
  for (const e of RANKED_MODELS) {
    assert.ok(e.match && e.match.length > 0, "match rules required");
    assert.ok(e.name, "name required");
    for (const k of ["smart", "useful", "fast"] as const) {
      assert.ok(e[k] >= 0 && e[k] <= 100, `${e.name}.${k} in range`);
    }
    // patterns must compile — a bad pattern must never break routing
    for (const rule of e.match) {
      if (rule.seg) new RegExp(`(?:^|[^a-z0-9])${rule.seg}(?:[^a-z0-9]|$)`, "i");
      if (rule.exact) new RegExp(`^${rule.exact}$`, "i");
    }
  }
});

test("weightedScore reweights per mode", () => {
  const smart = RANKED_MODELS.find((e) => e.match.some((r) => r.exact === "opus"));
  const fast = RANKED_MODELS.find((e) => e.match.some((r) => r.exact === "flash"));
  assert.ok(smart && fast, "curated entries must exist");
  // smart-first favors the smart model, fast-first favors the fast one
  assert.ok(weightedScore(smart, "smart") > weightedScore(fast, "smart"));
  assert.ok(weightedScore(fast, "fast") > weightedScore(smart, "fast"));
  // balanced lands between the extremes
  const b = weightedScore(smart, "balanced");
  assert.ok(b > weightedScore(smart, "fast") && b < weightedScore(smart, "smart"));
});

test("scoreModelName matches case-insensitively, null when unknown", () => {
  const s1 = scoreModelName("claude-opus-4-6", "balanced");
  const s2 = scoreModelName("Claude Opus", "balanced");
  assert.ok(s1 !== null && s2 !== null && Math.abs(s1 - s2) < 1e-9);
  assert.equal(scoreModelName("some-obscure-model-xyz", "balanced"), null);
  assert.equal(scoreModelName("", "balanced"), null);
});

test("P2-7 regression: unknown models are NOT misranked by substrings", () => {
  // Audit cases: these used to score as "Claude Opus 系" / "GPT Mini 系" /
  // "Gemini Flash 系" via unanchored substrings. They must stay unknown.
  assert.equal(scoreModelName("octopus-v1", "balanced"), null);
  assert.equal(scoreModelName("MiniMax-M2", "balanced"), null);
  assert.equal(scoreModelName("my-flash-model", "balanced"), null);
  assert.equal(scoreModelName("my-sonnet-fan-model", "balanced"), null);
  // Real vendor names still match.
  assert.notEqual(scoreModelName("claude-opus-4-6", "balanced"), null);
  assert.notEqual(scoreModelName("Claude Opus", "balanced"), null);
  assert.notEqual(scoreModelName("gemini-2.5-flash", "balanced"), null);
  assert.notEqual(scoreModelName("gemini-flash", "balanced"), null);
  assert.notEqual(scoreModelName("gpt-5", "balanced"), null);
  assert.notEqual(scoreModelName("deepseek-chat", "balanced"), null);
  assert.notEqual(scoreModelName("qwen-max", "balanced"), null);
  assert.notEqual(scoreModelName("kimi-k2", "balanced"), null);
  assert.notEqual(scoreModelName("llama-3.3-70b", "balanced"), null);
  assert.notEqual(scoreModelName("grok-4", "balanced"), null);
  // Short hand-typed names still match their family.
  assert.notEqual(scoreModelName("opus", "balanced"), null);
  assert.notEqual(scoreModelName("flash", "balanced"), null);
  assert.notEqual(scoreModelName("sonnet", "balanced"), null);
  assert.notEqual(scoreModelName("mini", "balanced"), null);
});

test("rankModelNames orders best-first, unknowns keep order at end", () => {
  const names = ["mystery-model-a", "gemini-flash", "claude-opus-4", "mystery-model-b"];
  const ranked = rankModelNames(names, "fast");
  // flash is the fastest family -> first under fast mode
  assert.equal(ranked[0], "gemini-flash");
  // unknowns keep relative order at the end
  assert.deepEqual(ranked.slice(-2), ["mystery-model-a", "mystery-model-b"]);
  const rankedSmart = rankModelNames(names, "smart");
  assert.equal(rankedSmart[0], "claude-opus-4");
});

test("rankModelNames is stable for ties", () => {
  const names = ["model-x", "model-y"];
  assert.deepEqual(rankModelNames(names, "balanced"), names);
});

test("buildRankingSlip is compact and honest", () => {
  const slip = buildRankingSlip("balanced");
  const lines = slip.split("\n");
  assert.ok(lines.length <= 6, `slip must stay token-small, got ${lines.length} lines`);
  assert.ok(slip.includes("均衡"), "mode label present");
  assert.ok(slip.includes("仅供参考"), "honest about curated snapshot");
  assert.ok(slip.includes("LMArena"), "source candidates noted");
  assert.ok(slip.includes("聪明/好用/快"), "reading guide present");
  const smartSlip = buildRankingSlip("smart");
  assert.ok(smartSlip.includes("聪明优先"));
  // different modes order differently
  assert.notEqual(slip.split("\n")[1], smartSlip.split("\n")[1]);
});
