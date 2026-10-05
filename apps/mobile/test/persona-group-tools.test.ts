/**
 * Persona group chat — AI management tools tests.
 *
 * Covers: create/list/add/remove/set_model/archive, validation
 * (2+ members, known personas, group caps), incognito refusal, trace.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import type { NewTraceEntry } from "../src/chat/cross-dialog-trace.js";
import type { PersonaCardLike } from "../src/chat/persona-group.js";
import { type PersonaGroupStorage, PersonaGroupStore } from "../src/chat/persona-group-store.js";
import { createPersonaGroupTools } from "../src/chat/persona-group-tools.js";
import { createPersonaApiGroupPrefStore } from "../src/persona/api-group-pref.js";

function fakeStorage(): PersonaGroupStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const PERSONAS: PersonaCardLike[] = [
  { id: "a", name: "嘟嘟", systemPrompt: "", personality: "", background: "", exampleDialogue: "" },
  { id: "b", name: "阿夜", systemPrompt: "", personality: "", background: "", exampleDialogue: "" },
  { id: "c", name: "小白", systemPrompt: "", personality: "", background: "", exampleDialogue: "" },
];

const API_GROUPS = [
  { id: "g1", name: "主力", model: "m1" },
  { id: "g2", name: "备用", model: "m2" },
] as ApiGroup[];

function makeTools(incognito = false) {
  const groups = new PersonaGroupStore(fakeStorage());
  const pref = createPersonaApiGroupPrefStore(fakeStorage());
  const traces: NewTraceEntry[] = [];
  const tools = createPersonaGroupTools({
    threadId: "thread-test",
    getPersonaId: async () => "a",
    groups,
    listPersonas: async () => PERSONAS,
    listApiGroups: () => API_GROUPS,
    apiGroupPref: pref,
    trace: {
      append: async (e: NewTraceEntry) => {
        traces.push(e);
        return { id: "t1", at: Date.now(), ...e };
      },
    },
    isIncognito: () => incognito,
  });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const run = (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name);
    assert.ok(tool, `tool ${name} is registered`);
    return tool.run(args, {
      authorize: async () => true,
    });
  };
  return { tools, groups, pref, traces, run };
}

async function mustGetGroup(groups: PersonaGroupStore, id: string) {
  const g = await groups.get(id);
  assert.ok(g, `group ${id} exists`);
  return g;
}

describe("persona_group_create", () => {
  it("creates a group with 2+ personas", async () => {
    const { run, groups, traces } = makeTools();
    const out = await run("persona_group_create", { name: "周末群", personas: ["嘟嘟", "阿夜"] });
    assert.ok(out.includes("周末群"));
    const list = await groups.list();
    assert.equal(list.length, 1);
    assert.deepEqual(
      list[0].members.map((m) => m.personaId),
      ["a", "b"],
    );
    assert.ok(traces.some((t) => t.action === "persona_group_create"));
  });
  it("resolves by id too", async () => {
    const { run, groups } = makeTools();
    await run("persona_group_create", { name: "g", personas: ["a", "c"] });
    const list = await groups.list();
    assert.deepEqual(
      list[0].members.map((m) => m.personaId),
      ["a", "c"],
    );
  });
  it("rejects fewer than 2 personas", async () => {
    const { run } = makeTools();
    await assert.rejects(
      () => run("persona_group_create", { name: "g", personas: ["嘟嘟"] }),
      /2 位/,
    );
  });
  it("rejects unknown personas (never guesses)", async () => {
    const { run } = makeTools();
    await assert.rejects(
      () => run("persona_group_create", { name: "g", personas: ["嘟嘟", "陌生人"] }),
      /找不到人设/,
    );
  });
  it("rejects empty name", async () => {
    const { run } = makeTools();
    await assert.rejects(
      () => run("persona_group_create", { name: " ", personas: ["a", "b"] }),
      /群名/,
    );
  });
  it("refuses in incognito", async () => {
    const { run } = makeTools(true);
    await assert.rejects(
      () => run("persona_group_create", { name: "g", personas: ["a", "b"] }),
      /不留痕/,
    );
  });
});

describe("persona_group_list", () => {
  it("lists groups with member names", async () => {
    const { run } = makeTools();
    await run("persona_group_create", { name: "周末群", personas: ["a", "b"] });
    const out = await run("persona_group_list", {});
    assert.ok(out.includes("周末群"));
    assert.ok(out.includes("嘟嘟"));
    assert.ok(out.includes("阿夜"));
  });
  it("honest empty state", async () => {
    const { run } = makeTools();
    const out = await run("persona_group_list", {});
    assert.ok(out.includes("还没有人设群聊"));
  });
});

describe("persona_group_add_member / remove_member", () => {
  it("adds and removes", async () => {
    const { run, groups } = makeTools();
    await run("persona_group_create", { name: "g", personas: ["a", "b"] });
    const id = (await groups.list())[0].id;
    const added = await run("persona_group_add_member", { group_id: id, persona: "小白" });
    assert.ok(added.includes("小白"));
    const removed = await run("persona_group_remove_member", { group_id: id, persona: "c" });
    assert.ok(removed.includes("离开"));
    const after = await mustGetGroup(groups, id);
    assert.deepEqual(
      after.members.map((m) => m.personaId),
      ["a", "b"],
    );
  });
  it("refuses to drop below 2 members", async () => {
    const { run, groups } = makeTools();
    await run("persona_group_create", { name: "g", personas: ["a", "b"] });
    const id = (await groups.list())[0].id;
    await assert.rejects(
      () => run("persona_group_remove_member", { group_id: id, persona: "b" }),
      /2 位/,
    );
  });
  it("rejects unknown group", async () => {
    const { run } = makeTools();
    await assert.rejects(
      () => run("persona_group_add_member", { group_id: "nope", persona: "a" }),
      /找不到群聊/,
    );
  });
});

describe("persona_group_set_model", () => {
  it("sets and clears a per-persona model", async () => {
    const { run, pref } = makeTools();
    const out = await run("persona_group_set_model", { persona: "嘟嘟", api_group: "备用" });
    assert.ok(out.includes("备用"));
    assert.equal(await pref.get("a"), "g2");
    await run("persona_group_set_model", { persona: "嘟嘟", api_group: "" });
    assert.equal(await pref.get("a"), null);
  });
  it("rejects unknown api group (never guesses)", async () => {
    const { run } = makeTools();
    await assert.rejects(
      () => run("persona_group_set_model", { persona: "嘟嘟", api_group: "不存在" }),
      /找不到模型/,
    );
  });
});

describe("persona_group_archive", () => {
  it("archives and restores", async () => {
    const { run, groups } = makeTools();
    await run("persona_group_create", { name: "g", personas: ["a", "b"] });
    const id = (await groups.list())[0].id;
    await run("persona_group_archive", { group_id: id });
    assert.equal((await groups.list()).length, 0);
    assert.equal((await groups.list(true)).length, 1);
    await run("persona_group_archive", { group_id: id, archived: false });
    assert.equal((await groups.list()).length, 1);
  });
});

describe("tool metadata", () => {
  it("all six tools carry the persona-group manual id", async () => {
    const { tools } = makeTools();
    assert.equal(tools.length, 6);
    for (const t of tools) {
      assert.equal(t.manualId, "persona-group");
      assert.ok(t.description.length > 10);
    }
  });
});
