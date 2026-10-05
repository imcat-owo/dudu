/**
 * Batch 7 (小功能 I) tests: token estimator, stats aggregation,
 * settings search matching, message meta, prefs store, translate langs.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getMessageMeta, observeMessages } from "../src/extras/message-meta.js";
import {
  DEFAULT_EXTRAS_PREFS,
  getExtrasPrefs,
  getNewChatSeq,
  requestNewChat,
  setExtrasPref,
  subscribeNewChat,
} from "../src/extras/prefs.js";
import { matchSettingsQuery } from "../src/extras/settings-search.js";
import {
  dayKeyOf,
  formatTokens,
  formatUsd,
  rangeEndMs,
  rangeStartMs,
  summarizeUsage,
} from "../src/extras/stats.js";
import { estimateTokens, formatTokenCount } from "../src/extras/token-estimate.js";
import { TRANSLATE_LANGS, translateLangLabel } from "../src/extras/translate.js";

describe("token estimator (I6)", () => {
  it("empty string is 0", () => {
    assert.equal(estimateTokens(""), 0);
  });
  it("english text estimates sanely", () => {
    const n = estimateTokens("hello world, this is a test");
    assert.ok(n >= 5 && n <= 12, `got ${n}`);
  });
  it("CJK counts roughly one token per char", () => {
    const n = estimateTokens("你好世界");
    assert.ok(n >= 3 && n <= 6, `got ${n}`);
  });
  it("mixed text doesn't explode", () => {
    const n = estimateTokens("帮我翻译 hello world 这段话");
    assert.ok(n > 0 && n < 40, `got ${n}`);
  });
  it("formatTokenCount", () => {
    assert.equal(formatTokenCount(42), "42");
    assert.equal(formatTokenCount(1500), "1.5k");
    assert.equal(formatTokenCount(23000), "23k");
  });
});

describe("stats aggregation (I3)", () => {
  const rec = (at: number, model: string, usd: number, groupId = "g1", groupName = "main") => ({
    id: `u_${at}`,
    at,
    groupId,
    groupName,
    model,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: usd,
  });
  it("summarizes totals and rankings", () => {
    const now = Date.now();
    const records = [
      rec(now - 1000, "gpt-4o", 0.05),
      rec(now - 2000, "gpt-4o", 0.05),
      rec(now - 3000, "claude-x", 0.2, "g2", "backup"),
    ];
    const s = summarizeUsage(records, 0, now + 1000);
    assert.equal(s.requests, 3);
    assert.equal(s.totalTokens, 450);
    assert.ok(Math.abs(s.totalUsd - 0.3) < 1e-9);
    assert.equal(s.byModel[0]!.model, "claude-x");
    assert.equal(s.byModel[1]!.model, "gpt-4o");
    assert.equal(s.byGroup[0]!.groupId, "g2");
    assert.equal(s.activeDays, 1);
  });
  it("respects the date range", () => {
    const now = Date.now();
    const records = [rec(now - 40 * 86_400_000, "old", 1)];
    const s = summarizeUsage(records, rangeStartMs("30d", now), rangeEndMs("30d", now));
    assert.equal(s.requests, 0);
    const all = summarizeUsage(records, rangeStartMs("all", now), rangeEndMs("all", now));
    assert.equal(all.requests, 1);
  });
  it("month range covers the previous full month", () => {
    const d = new Date(2026, 9, 5); // Oct 5 2026
    const now = d.getTime();
    const start = rangeStartMs("month", now);
    const end = rangeEndMs("month", now);
    assert.equal(new Date(start).getMonth(), 8); // September
    assert.equal(new Date(start).getDate(), 1);
    assert.equal(new Date(end).getMonth(), 9); // October
    assert.equal(new Date(end).getDate(), 1);
  });
  it("dayKeyOf is stable", () => {
    assert.equal(dayKeyOf(new Date(2026, 0, 5, 12).getTime()), "2026-01-05");
  });
  it("formatters", () => {
    assert.equal(formatUsd(0.005), "<$0.01");
    assert.equal(formatUsd(1.234), "$1.23");
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(1500), "1.5k");
    assert.equal(formatTokens(2_500_000), "2.50M");
  });
});

describe("settings search (I2)", () => {
  it("empty query matches everything", () => {
    assert.equal(matchSettingsQuery("", "外观", ["theme"]), true);
    assert.equal(matchSettingsQuery("   ", "外观", ["theme"]), true);
  });
  it("matches title substring", () => {
    assert.equal(matchSettingsQuery("外观", "外观", []), true);
    assert.equal(matchSettingsQuery("用量", "用量统计", []), true);
  });
  it("matches keyword aliases case-insensitively", () => {
    assert.equal(matchSettingsQuery("tts", "语音", ["TTS", "voice"]), true);
    assert.equal(matchSettingsQuery("MCP", "技能", ["mcp"]), true);
  });
  it("rejects non-matches", () => {
    assert.equal(matchSettingsQuery("xyz-nope", "外观", ["theme"]), false);
  });
});

describe("message meta (I11)", () => {
  it("records first-seen time and model", () => {
    observeMessages(
      [
        { id: "m1", role: "assistant" },
        { id: "m2", role: "user" },
      ],
      "gpt-4o",
    );
    const m1 = getMessageMeta("m1");
    const m2 = getMessageMeta("m2");
    assert.ok(m1 && m1.at > 0 && m1.model === "gpt-4o");
    assert.ok(m2 && m2.at > 0 && m2.model === undefined);
  });
  it("does not overwrite existing entries", () => {
    const before = getMessageMeta("m1")!.at;
    observeMessages([{ id: "m1", role: "assistant" }], "other-model");
    assert.equal(getMessageMeta("m1")!.at, before);
    assert.equal(getMessageMeta("m1")!.model, "gpt-4o");
  });
});

describe("translate languages (I1)", () => {
  it("has a sane list with own-language labels", () => {
    assert.ok(TRANSLATE_LANGS.length >= 8);
    assert.equal(translateLangLabel("en"), "English");
    assert.equal(translateLangLabel("zh-Hans"), "简体中文");
    assert.equal(translateLangLabel("ja"), "日本語");
  });
  it("falls back to the code for unknown langs", () => {
    assert.equal(translateLangLabel("xx"), "xx");
  });
});

describe("extras prefs store", () => {
  before(() => {
    (AsyncStorage as any).getItem = async () => null;
    (AsyncStorage as any).setItem = async () => {};
  });
  it("defaults match Kelivo's (I7 iOS-true, I10 true/false/true, I12 8s, I13 500/off)", () => {
    const d = DEFAULT_EXTRAS_PREFS;
    assert.equal(d.enterToSendMobile, true);
    assert.equal(d.newChatOnLaunch, true);
    assert.equal(d.newChatOnPersonaSwitch, false);
    assert.equal(d.newChatAfterDelete, true);
    assert.equal(d.autoScroll, true);
    assert.equal(d.autoScrollIdleSeconds, 8);
    assert.equal(d.collapseLongUserMessages, false);
    assert.equal(d.collapseThresholdChars, 500);
    assert.equal(d.markdownUser, true);
    assert.equal(d.markdownAssistant, true);
    assert.equal(d.markdownReasoning, true);
    assert.equal(d.draftTokenCount, true);
    assert.equal(d.keepScreenOnWhileGenerating, true);
    assert.equal(d.hapticsEnabled, true);
  });
  it("setExtrasPref updates and persists", async () => {
    await setExtrasPref("autoScrollIdleSeconds", 12);
    assert.equal(getExtrasPrefs().autoScrollIdleSeconds, 12);
    await setExtrasPref("autoScrollIdleSeconds", 8);
  });
  it("new-chat bus fires subscribers (I10)", () => {
    const seen: number[] = [];
    const unsub = subscribeNewChat((seq) => seen.push(seq));
    const beforeSeq = getNewChatSeq();
    requestNewChat();
    assert.deepEqual(seen, [beforeSeq + 1]);
    unsub();
  });
});
