/**
 * Proactive initiative （主动约定） — AI management tools tests.
 *
 * Under test:
 *  1. All six tools exist with manualId "initiative" (纸条机制).
 *  2. The create tool's description bakes in the permission iron rule
 *     (never invent rules unprompted).
 *  3. create validates input and refuses unknown personas; list/archive/
 *     restore/delete/run_now behave honestly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FireOutcome } from "../src/initiative/executor.js";
import type { InitiativeRule } from "../src/initiative/rules.js";
import { InitiativeStore } from "../src/initiative/store.js";
import { createInitiativeTools, type InitiativeToolEnv } from "../src/initiative/tools.js";

const NOW = Date.UTC(2026, 9, 5, 4, 0, 0);

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

interface Ctx {
  env: InitiativeToolEnv;
  store: InitiativeStore;
  mutated: InitiativeRule[];
  retired: string[];
  fired: string[];
  fireImpl: (ruleId: string) => Promise<FireOutcome>;
}

function makeCtx(): Ctx {
  const store = new InitiativeStore(fakeKv(), { nowMs: () => NOW });
  const ctx: Ctx = {
    store,
    mutated: [],
    retired: [],
    fired: [],
    fireImpl: async (ruleId) => {
      ctx.fired.push(ruleId);
      return { fired: true, threadId: "t1", text: "hi" };
    },
    env: null as unknown as InitiativeToolEnv,
  };
  ctx.env = {
    initiativeStore: store,
    getPersona: async (id: string) => (id === "personaA" ? ({ id, name: "A" } as never) : null),
    listPersonas: async () => [{ id: "personaA", name: "A" }],
    onMutated: async (rule) => {
      ctx.mutated.push(rule);
    },
    onRetired: async (id) => {
      ctx.retired.push(id);
    },
    fireNow: (ruleId) => ctx.fireImpl(ruleId),
    nowMs: () => NOW,
  };
  return ctx;
}

const toolCtx = { authorize: async () => true } as never;

async function runTool(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = createInitiativeTools(ctx.env);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool.run(args, toolCtx);
}

describe("initiative AI tools", () => {
  it("all six tools exist with manualId 'initiative'", () => {
    const ctx = makeCtx();
    const tools = createInitiativeTools(ctx.env);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "initiative_rule_archive",
      "initiative_rule_create",
      "initiative_rule_delete",
      "initiative_rule_list",
      "initiative_rule_restore",
      "initiative_rule_run_now",
    ]);
    for (const t of tools) assert.equal(t.manualId, "initiative");
  });

  it("create description carries the permission iron rule", () => {
    const ctx = makeCtx();
    const tools = createInitiativeTools(ctx.env);
    const create = tools.find((t) => t.name === "initiative_rule_create");
    assert.ok(create, "initiative_rule_create exists");
    assert.ok(
      create.description.includes("NEVER invent") ||
        create.description.includes("never invent") ||
        create.description.includes("unprompted"),
      "permission constraint is baked into the tool description",
    );
    assert.ok(create.description.includes("ONE persona"), "persona binding is documented");
  });

  it("create -> list -> archive -> restore -> delete round-trips", async () => {
    const ctx = makeCtx();
    const created = await runTool(ctx, "initiative_rule_create", {
      personaId: "personaA",
      title: "早安",
      topic: "说早安",
      type: "daily",
      hour: 8,
      minute: 0,
    });
    assert.ok(created.includes("早安"));
    assert.equal(ctx.mutated.length, 1, "creation re-arms the schedule");

    const listed = await runTool(ctx, "initiative_rule_list", {});
    assert.ok(listed.includes("早安") && listed.includes("每天 08:00"));

    const id = ctx.mutated[0].id;
    assert.ok((await runTool(ctx, "initiative_rule_archive", { ruleId: id })).includes("archived"));
    assert.deepEqual(ctx.retired, [id], "archive disarms the schedule");
    assert.ok(
      (await runTool(ctx, "initiative_rule_list", { includeArchived: false })).includes(
        "No initiative rules",
      ),
    );

    assert.ok((await runTool(ctx, "initiative_rule_restore", { ruleId: id })).includes("restored"));
    assert.equal(ctx.mutated.length, 2, "restore re-arms the schedule");

    assert.ok((await runTool(ctx, "initiative_rule_delete", { ruleId: id })).includes("deleted"));
    assert.deepEqual(ctx.retired, [id, id]);
    assert.ok((await runTool(ctx, "initiative_rule_list", {})).includes("No initiative rules"));
  });

  it("create refuses unknown personas and invalid input honestly", async () => {
    const ctx = makeCtx();
    await assert.rejects(
      () =>
        runTool(ctx, "initiative_rule_create", {
          personaId: "ghost",
          title: "x",
          topic: "y",
          type: "daily",
          hour: 8,
          minute: 0,
        }),
      /Persona not found/,
    );
    await assert.rejects(
      () =>
        runTool(ctx, "initiative_rule_create", {
          personaId: "personaA",
          title: "",
          topic: "y",
          type: "daily",
          hour: 8,
          minute: 0,
        }),
      /title/,
    );
    await assert.rejects(
      () => runTool(ctx, "initiative_rule_archive", { ruleId: "nope" }),
      /not found/i,
    );
  });

  it("run_now reports the executor outcome honestly", async () => {
    const ctx = makeCtx();
    await runTool(ctx, "initiative_rule_create", {
      personaId: "personaA",
      title: "午安",
      topic: "说午安",
      type: "daily",
      hour: 12,
      minute: 0,
    });
    const id = ctx.mutated[0].id;
    const ok = await runTool(ctx, "initiative_rule_run_now", { ruleId: id });
    assert.ok(ok.includes("t1") && ok.includes("hi"));

    ctx.fireImpl = async () => ({ fired: false, reason: "capped" });
    const capped = await runTool(ctx, "initiative_rule_run_now", { ruleId: id });
    assert.ok(capped.includes("capped"), "cap failure is reported, not hidden");
  });
});
