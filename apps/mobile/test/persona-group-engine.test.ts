/**
 * Persona group chat — turn engine tests (fakes, no network).
 *
 * The honest multi-turn simulation her spec demands:
 *   her "@A …" -> A replies (mentioned, must) -> B (relevant) joins ->
 *   C (irrelevant) stays silent (logged) -> she speaks -> queue resets.
 * Plus: per-persona API isolation, bounded interaction (no ping-pong),
 * memory bridge, tool-call folding, silence handling.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import type { NewTraceEntry } from "../src/chat/cross-dialog-trace.js";
import type { PersonaCardLike } from "../src/chat/persona-group.js";
import {
  type GroupTurnTool,
  handleGroupUserMessage,
  type PersonaGroupEngineDeps,
} from "../src/chat/persona-group-engine.js";
import { type PersonaGroupStorage, PersonaGroupStore } from "../src/chat/persona-group-store.js";

function fakeStorage(): PersonaGroupStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

function fakeGroup(id: string, model: string): ApiGroup {
  return {
    id,
    name: `group-${id}`,
    vendor: "openai",
    baseUrl: "https://example.com/v1",
    model,
  } as ApiGroup;
}

const PERSONAS: Record<string, PersonaCardLike> = {
  a: {
    id: "a",
    name: "嘟嘟",
    systemPrompt: "你是嘟嘟",
    personality: "",
    background: "",
    exampleDialogue: "",
  },
  b: {
    id: "b",
    name: "阿夜",
    systemPrompt: "你是阿夜",
    personality: "",
    background: "",
    exampleDialogue: "",
  },
  c: {
    id: "c",
    name: "小白",
    systemPrompt: "你是小白",
    personality: "",
    background: "",
    exampleDialogue: "",
  },
};

interface Script {
  /** personaId -> reply text (or THROW:... to fail, or "…" for silence) */
  replies: Record<string, string>;
  /** personaId -> judged relevant */
  relevant: Record<string, boolean>;
}

function makeDeps(script: Script) {
  const groups = new PersonaGroupStore(fakeStorage());
  const seenGroups: Array<{ personaId: string; groupId: string }> = [];
  const traces: NewTraceEntry[] = [];
  const memoryCalls: string[] = [];
  const groupA = fakeGroup("gA", "model-a");
  const groupB = fakeGroup("gB", "model-b");
  const groupC = fakeGroup("gC", "model-c");
  const apiByPersona: Record<string, ApiGroup> = { a: groupA, b: groupB, c: groupC };
  // B's model is DOWN in the failure script — resolved fine, generate throws.

  const deps: PersonaGroupEngineDeps = {
    groups,
    getPersona: async (id) => PERSONAS[id] ?? null,
    resolveApiGroup: async (personaId) => {
      const g = apiByPersona[personaId];
      if (!g) return null;
      return g;
    },
    buildMemorySection: async (userText) => {
      memoryCalls.push(userText);
      return `记忆：${userText.slice(0, 10)}`;
    },
    generate: async (group, _system, _user, _tools) => {
      const personaId = Object.keys(apiByPersona).find((k) => apiByPersona[k].id === group.id);
      assert.ok(personaId, "persona for group");
      seenGroups.push({ personaId, groupId: group.id });
      const reply = script.replies[personaId] ?? `${PERSONAS[personaId].name}：收到`;
      if (reply.startsWith("THROW:")) throw new Error(reply.slice(6));
      const tools = reply.startsWith("TOOLS:") ? [{ name: "web_search", ok: true }] : [];
      return { text: reply.replace(/^TOOLS:/, ""), tools };
    },
    judge: async (persona) => script.relevant[persona.id] ?? false,
    listTools: () => [] as GroupTurnTool[],
    trace: {
      append: async (e: NewTraceEntry) => {
        traces.push(e);
        return { id: "t1", at: Date.now(), ...e };
      },
    },
    herName: "她",
    random: () => 0.999, // deterministic order for assertions
  };
  return { deps, groups, seenGroups, traces, memoryCalls };
}

async function mustGetGroup(groups: PersonaGroupStore, id: string) {
  const g = await groups.get(id);
  assert.ok(g, `group ${id} exists`);
  return g;
}

async function createGroup(groups: PersonaGroupStore, name = "测试群") {
  return groups.create(name, ["a", "b", "c"]);
}

describe("multi-turn simulation (her spec, end to end)", () => {
  it("@A -> A replies, B (relevant) joins, C (irrelevant) silent + logged", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "嘟嘟：火锅吧", b: "阿夜：附议" },
      relevant: { b: true, c: false },
    });
    const group = await createGroup(groups);
    const report = await handleGroupUserMessage(deps, group.id, "@嘟嘟 今晚吃啥");

    assert.deepEqual(report.speakers, ["a", "b"]);
    assert.ok(report.silent.includes("c"));

    const after = await mustGetGroup(groups, group.id);
    const texts = after.messages.map((m) => m.text);
    assert.ok(texts.includes("@嘟嘟 今晚吃啥"));
    assert.ok(texts.includes("嘟嘟：火锅吧"));
    assert.ok(texts.includes("阿夜：附议"));
    // C said nothing.
    assert.ok(!texts.some((t) => t.includes("小白：")));
    // The persona label is stored (not just the text).
    const aMsg = after.messages.find((m) => m.text === "嘟嘟：火锅吧");
    assert.ok(aMsg, "A message stored");
    assert.deepEqual(aMsg.from, { kind: "persona", personaId: "a", personaName: "嘟嘟" });
  });

  it("she speaks -> queue resets (spokeThisRound cleared)", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "嘟嘟：在", b: "阿夜：在", c: "小白：在" },
      relevant: { a: true, b: true, c: true },
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "大家在吗");
    const after1 = await mustGetGroup(groups, group.id);
    assert.ok(after1.spokeThisRound.length > 0);
    // She speaks again -> new round, everyone eligible again.
    const report2 = await handleGroupUserMessage(deps, group.id, "@嘟嘟 还在吗");
    assert.ok(report2.speakers.includes("a"), "A must be able to speak again in the new round");
  });

  it("per-persona API: each persona generates with its OWN group", async () => {
    const { deps, groups, seenGroups } = makeDeps({
      replies: { a: "a", b: "b", c: "c" },
      relevant: { a: true, b: true, c: true },
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "hello");
    const byPersona = new Map(seenGroups.map((s) => [s.personaId, s.groupId]));
    assert.equal(byPersona.get("a"), "gA");
    assert.equal(byPersona.get("b"), "gB");
    assert.equal(byPersona.get("c"), "gC");
  });

  it("one persona's model failing -> isolated error note, others continue", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "嘟嘟：在", b: "THROW:connection refused", c: "小白：在" },
      relevant: { a: true, b: true, c: true },
    });
    const group = await createGroup(groups);
    const report = await handleGroupUserMessage(deps, group.id, "大家在吗");
    assert.ok(report.failed.includes("b"));
    const after = await mustGetGroup(groups, group.id);
    const texts = after.messages.map((m) => m.text);
    // B's failure is B's own note — never invented lines for B.
    assert.ok(texts.some((t) => t.includes("阿夜") && t.includes("模型出错了")));
    assert.ok(!texts.some((t) => t.startsWith("阿夜：") && !t.includes("模型出错了")));
    // A and C still spoke.
    assert.ok(texts.includes("嘟嘟：在"));
    assert.ok(texts.includes("小白：在"));
  });

  it("bounded interaction: no ping-pong (each persona at most once per round)", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "嘟嘟：1", b: "阿夜：2", c: "小白：3" },
      // Everyone finds everything relevant — the bound must still hold.
      relevant: { a: true, b: true, c: true },
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "聊聊");
    const after = await mustGetGroup(groups, group.id);
    const personaMsgs = after.messages.filter((m) => m.from.kind === "persona");
    const counts = new Map<string, number>();
    for (const m of personaMsgs) {
      const pid = (m.from as { personaId: string }).personaId;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
    for (const [pid, n] of counts) {
      assert.ok(n <= 1, `${pid} spoke ${n} times in one round`);
    }
  });

  it("memory bridge: the persona's own memory section feeds its turn", async () => {
    const { deps, groups, memoryCalls } = makeDeps({
      replies: { a: "嘟嘟：在" },
      relevant: {},
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "@嘟嘟 记得我爱喝什么吗");
    assert.ok(memoryCalls.length > 0);
    assert.ok(memoryCalls.some((c) => c.includes("记得我爱喝什么吗")));
  });

  it("tool calls are folded into the stored message", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "TOOLS:嘟嘟：查到了" },
      relevant: {},
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "@嘟嘟 查一下");
    const after = await mustGetGroup(groups, group.id);
    const msg = after.messages.find((m) => m.text === "嘟嘟：查到了");
    assert.ok(msg, "message with tools stored");
    assert.deepEqual(msg.tools, [{ name: "web_search", ok: true }]);
  });

  it("a persona answering '…' stays silent and is logged", async () => {
    const { deps, groups } = makeDeps({
      replies: { a: "…" },
      relevant: {},
    });
    const group = await createGroup(groups);
    const report = await handleGroupUserMessage(deps, group.id, "@嘟嘟 在吗");
    assert.ok(!report.speakers.includes("a"));
    const after = await mustGetGroup(groups, group.id);
    assert.ok(!after.messages.some((m) => m.text === "…"));
  });

  it("silent members are 记账'd in the trace", async () => {
    const { deps, groups, traces } = makeDeps({
      replies: { a: "嘟嘟：在" },
      relevant: {},
    });
    const group = await createGroup(groups);
    await handleGroupUserMessage(deps, group.id, "@嘟嘟 在吗");
    const round = traces.find((t) => t.action === "persona_group_round");
    assert.ok(round, "round must be traced");
    assert.ok(round.summary, "round has summary");
    // Speakers/silent are recorded in the summary (trace entry shape is fixed).
    assert.ok(round.summary.includes("1 位发言"));
    assert.ok(round.summary.includes("沉默 2 位"));
  });

  it("refuses unknown and archived groups", async () => {
    const { deps, groups } = makeDeps({ replies: {}, relevant: {} });
    await assert.rejects(() => handleGroupUserMessage(deps, "nope", "hi"), /group not found/);
    const group = await createGroup(groups);
    await groups.setArchived(group.id, true);
    await assert.rejects(() => handleGroupUserMessage(deps, group.id, "hi"), /archived/);
  });
});
