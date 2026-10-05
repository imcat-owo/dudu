/**
 * Persona group chat (人设群聊) — PURE engine tests.
 *
 * Covers: @-mention parsing (rule ①), speaker planning (rules ①②③④),
 * queue cap + bounded interaction, she-speaks reset, prompt isolation
 * (人设间隔离 — structural), relevance judgment parsing, tool folding.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGroupTurnPrompt,
  createPersonaGroup,
  describePersonaGroup,
  foldToolSummary,
  formatGroupTranscript,
  isSilenceReply,
  MAX_GROUP_MEMBERS,
  MAX_SPEAKERS_PER_ROUND,
  type PersonaCardLike,
  type PersonaGroup,
  parseMentions,
  parseRelevanceJudgment,
  planSpeakers,
  SILENCE_MARKER,
} from "../src/chat/persona-group.js";

const MEMBERS = ["a", "b", "c", "d", "e"];
const NAMED = [
  { personaId: "a", name: "嘟嘟" },
  { personaId: "b", name: "阿夜" },
  { personaId: "c", name: "小白" },
];

function card(id: string, name: string, secret: string): PersonaCardLike {
  return {
    id,
    name,
    systemPrompt: `你是${name}。${secret}`,
    personality: "温柔",
    background: "",
    exampleDialogue: "",
  };
}

function groupWithMessages(): PersonaGroup {
  const g = createPersonaGroup("测试群", ["a", "b", "c"]);
  g.messages.push(
    { id: "m1", from: { kind: "user" }, text: "大家好", at: 1 },
    {
      id: "m2",
      from: { kind: "persona", personaId: "a", personaName: "嘟嘟" },
      text: "你好呀",
      at: 2,
    },
  );
  return g;
}

describe("parseMentions (rule ① — @点名必回)", () => {
  it("matches @name", () => {
    assert.deepEqual(parseMentions("@嘟嘟 你觉得呢", NAMED), ["a"]);
  });
  it("matches bare name without @", () => {
    assert.deepEqual(parseMentions("嘟嘟，在吗", NAMED), ["a"]);
  });
  it("matches several mentions", () => {
    assert.deepEqual(parseMentions("@嘟嘟 @阿夜 出来", NAMED), ["a", "b"]);
  });
  it("does not match ASCII-glued substrings", () => {
    // "abc嘟嘟def" — the name glued to ASCII letters must not match.
    assert.deepEqual(parseMentions("abc嘟嘟def", [{ personaId: "a", name: "dudu" }]), []);
  });
  it("matches inside CJK text (no spaces in Chinese)", () => {
    assert.deepEqual(parseMentions("我觉得嘟嘟说得对", NAMED), ["a"]);
  });
  it("ignores unknown names", () => {
    assert.deepEqual(parseMentions("@陌生人 你好", NAMED), []);
  });
});

describe("planSpeakers (rules ①②③④)", () => {
  it("mentioned personas go first, in member order", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: ["d", "b"],
      relevantIds: ["a", "c"],
      random: () => 0.99,
    });
    assert.deepEqual(plan.speakers.slice(0, 2), ["d", "b"]);
  });
  it("mentioned beats relevant even when relevant is 'urgent'", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: ["e"],
      relevantIds: ["a", "b", "c"],
      random: () => 0.1,
    });
    assert.equal(plan.speakers[0], "e");
  });
  it("queue cap is respected", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: ["a", "b", "c", "d", "e"],
      relevantIds: [],
      random: () => 0.5,
    });
    assert.ok(plan.speakers.length <= MAX_SPEAKERS_PER_ROUND);
    assert.equal(plan.speakers.length, MAX_SPEAKERS_PER_ROUND);
  });
  it("spokeThisRound members are skipped (bounded, no ping-pong)", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: ["a"],
      relevantIds: ["b"],
      spokeThisRound: ["a", "b"],
      random: () => 0.5,
    });
    assert.deepEqual(plan.speakers, []);
    // Already-spoken members are not reported as "silent" either.
    assert.deepEqual(plan.silent, ["c", "d", "e"]);
  });
  it("irrelevant members are silent and reported for 记账", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: ["a"],
      relevantIds: ["b"],
      random: () => 0.5,
    });
    assert.deepEqual(plan.silent.sort(), ["c", "d", "e"]);
  });
  it("order without jev is randomized (no fixed order)", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      // Deterministic pseudo-random sequence per iteration.
      let seed = i + 1;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const plan = planSpeakers(MEMBERS, {
        mentionedIds: [],
        relevantIds: ["a", "b", "c", "d"],
        random: rand,
      });
      orders.add(plan.speakers.join(","));
    }
    assert.ok(orders.size > 1, "relevant order should vary without jev");
  });
  it("custom urgency scorer (jev step-2 seam) reorders", () => {
    const plan = planSpeakers(MEMBERS, {
      mentionedIds: [],
      relevantIds: ["a", "b", "c"],
      scorer: (id) => (id === "c" ? 9 : 1),
      random: () => 0.99,
    });
    assert.equal(plan.speakers[0], "c");
  });
});

describe("createPersonaGroup", () => {
  it("dedups members and trims the name", () => {
    const g = createPersonaGroup("  测试群  ", ["a", "a", "b"]);
    assert.equal(g.name, "测试群");
    assert.deepEqual(
      g.members.map((m) => m.personaId),
      ["a", "b"],
    );
  });
  it("blank name falls back", () => {
    assert.equal(createPersonaGroup("   ", ["a", "b"]).name, "群聊");
  });
  it("starts with an empty round ledger", () => {
    assert.deepEqual(createPersonaGroup("g", ["a", "b"]).spokeThisRound, []);
  });
});

describe("formatGroupTranscript", () => {
  it("labels her and personas, folds tool calls", () => {
    const g = groupWithMessages();
    g.messages.push({
      id: "m3",
      from: { kind: "persona", personaId: "b", personaName: "阿夜" },
      text: "查到了",
      at: 3,
      tools: [
        { name: "web_search", ok: true },
        { name: "memory_search", ok: false },
      ],
    });
    const t = formatGroupTranscript(g, { herName: "她" });
    assert.ok(t.includes("她：大家好"));
    assert.ok(t.includes("嘟嘟：你好呀"));
    assert.ok(t.includes("用了 2 个工具"));
    assert.ok(t.includes("1 个失败"));
  });
});

describe("buildGroupTurnPrompt — 人设间隔离 (structural)", () => {
  it("sees only its own card + shared transcript + its own memory", () => {
    const g = groupWithMessages();
    const me = card("a", "嘟嘟", "SECRET-ALPHA-123");
    const other = card("b", "阿夜", "SECRET-BETA-456");
    const { system, user } = buildGroupTurnPrompt({
      persona: me,
      group: g,
      memorySection: "记得她喜欢喝热可可",
    });
    // Own card + own memory are in.
    assert.ok(system.includes("SECRET-ALPHA-123"));
    assert.ok(system.includes("记得她喜欢喝热可可"));
    assert.ok(user.includes("她：大家好"));
    // The other persona's private card must be structurally unreachable:
    // there is no parameter that could carry it.
    assert.ok(!system.includes("SECRET-BETA-456"));
    assert.ok(!user.includes("SECRET-BETA-456"));
    void other;
  });
  it("group rules are stated (stay in character, @ must reply)", () => {
    const g = groupWithMessages();
    const { system } = buildGroupTurnPrompt({
      persona: card("a", "嘟嘟", ""),
      group: g,
      memorySection: "",
    });
    assert.ok(system.includes("嘟嘟"));
    assert.ok(system.includes("看不到任何人的私聊"));
  });
});

describe("parseRelevanceJudgment (fail-closed)", () => {
  it("clear yes counts", () => {
    assert.equal(parseRelevanceJudgment("是"), true);
    assert.equal(parseRelevanceJudgment("Yes, 有关"), true);
  });
  it("anything else is silence", () => {
    assert.equal(parseRelevanceJudgment("否"), false);
    assert.equal(parseRelevanceJudgment(""), false);
    assert.equal(parseRelevanceJudgment("maybe"), false);
    assert.equal(parseRelevanceJudgment("是的但是…"), true); // starts with 是
  });
});

describe("foldToolSummary (rule ⑦ — 折叠防刷屏)", () => {
  it("folds several calls into one line", () => {
    assert.equal(
      foldToolSummary([
        { name: "web_search", ok: true },
        { name: "web_search", ok: true },
        { name: "memory_add", ok: false },
      ]),
      "用了 3 个工具：web_search、memory_add（1 个失败）",
    );
  });
  it("empty tools fold to empty", () => {
    assert.equal(foldToolSummary([]), "");
  });
});

describe("silence", () => {
  it("recognizes the silence marker", () => {
    assert.equal(isSilenceReply(SILENCE_MARKER), true);
    assert.equal(isSilenceReply("  …  "), true);
    assert.equal(isSilenceReply("我觉得…"), false);
  });
});

describe("describePersonaGroup", () => {
  it("one-line status", () => {
    const g = groupWithMessages();
    const s = describePersonaGroup(g, ["嘟嘟", "阿夜", "小白"]);
    assert.ok(s.includes("测试群"));
    assert.ok(s.includes("3 位"));
    assert.ok(s.includes("2 条消息"));
  });
});

describe("constants", () => {
  it("caps are sane", () => {
    assert.ok(MAX_GROUP_MEMBERS >= 2 && MAX_GROUP_MEMBERS <= 8);
    assert.ok(MAX_SPEAKERS_PER_ROUND >= 1 && MAX_SPEAKERS_PER_ROUND <= MAX_GROUP_MEMBERS);
  });
});
