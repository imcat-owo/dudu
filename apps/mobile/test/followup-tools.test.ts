/**
 * Memory-driven next-day follow-up （次日跟进） — AI tools tests.
 *
 * Under test:
 *  1. All four tools exist with manualId "followup" (纸条机制).
 *  2. followup_add: creates the item + a backing one_time initiative rule;
 *     refuses utterances without a detectable date; dedups.
 *  3. followup_list shows items; followup_delete removes the item and
 *     retires the backing rule; followup_set_enabled flips the master
 *     toggle (archiving/restoring backing rules).
 *  4. INCOGNITO_BLOCKED_TOOLS blocks the three write tools but not list
 *     (FINAL-AUDIT hard lesson).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import { FollowupStore } from "../src/followup/store.js";
import { createFollowupTools, type FollowupToolEnv } from "../src/followup/tools.js";
import { InitiativeStore } from "../src/initiative/store.js";

// Tue 2026-10-06 20:00 Shanghai.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
  };
}

interface Harness {
  env: FollowupToolEnv;
  followupStore: FollowupStore;
  initiativeStore: InitiativeStore;
  retired: string[];
  rescheduled: string[];
  persona: { id: string; name: string } | null;
}

function makeHarness(): Harness {
  const kv = fakeKv();
  const followupStore = new FollowupStore(kv, { nowMs: () => NOW });
  const initiativeStore = new InitiativeStore(kv, { nowMs: () => NOW });
  const h: Harness = {
    env: null as unknown as FollowupToolEnv,
    followupStore,
    initiativeStore,
    retired: [],
    rescheduled: [],
    persona: { id: "personaA", name: "A" },
  };
  h.env = {
    followupStore,
    initiativeStore,
    storage: kv,
    getPersona: async (id: string) => (id === "personaA" && h.persona ? h.persona : null) as never,
    listPersonas: async () => (h.persona ? [h.persona] : []),
    onMutated: async (rule) => {
      h.rescheduled.push(rule.id);
    },
    onRetired: async (ruleId: string) => {
      h.retired.push(ruleId);
    },
    nowMs: () => NOW,
  };
  return h;
}

const toolCtx = { authorize: async () => true } as never;

async function runTool(h: Harness, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = createFollowupTools(h.env);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool.run(args, toolCtx);
}

describe("followup tools", () => {
  it("all four tools exist with manualId initiative", () => {
    const h = makeHarness();
    const tools = createFollowupTools(h.env);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "followup_add",
      "followup_delete",
      "followup_list",
      "followup_set_enabled",
    ]);
    // The follow-up docs live inside the initiative manual （纸条机制）.
    for (const t of tools) assert.equal(t.manualId, "initiative");
  });

  it("add creates an item + backing one_time rule and tells her", async () => {
    const h = makeHarness();
    const out = await runTool(h, "followup_add", {
      text: "我明天有个面试",
      personaId: "personaA",
    });
    assert.ok(out.includes("面试"));
    assert.ok(out.includes("Tracking"));
    const items = await h.followupStore.list(false);
    assert.equal(items.length, 1);
    assert.equal(items[0].what, "面试");
    assert.equal(items[0].status, "active");
    // Backing one_time rule exists and was scheduled.
    const rule = await h.initiativeStore.get(items[0].ruleId);
    assert.ok(rule);
    assert.equal(rule.type, "one_time");
    assert.equal(h.rescheduled.length, 1);
  });

  it("add refuses when no date/event can be detected", async () => {
    const h = makeHarness();
    await assert.rejects(() =>
      runTool(h, "followup_add", { text: "我想你了", personaId: "personaA" }),
    );
    assert.equal((await h.followupStore.list(false)).length, 0);
  });

  it("add refuses unknown personas", async () => {
    const h = makeHarness();
    await assert.rejects(() =>
      runTool(h, "followup_add", { text: "我明天有个面试", personaId: "ghost" }),
    );
  });

  it("add dedups the same event", async () => {
    const h = makeHarness();
    await runTool(h, "followup_add", { text: "我明天有个面试", personaId: "personaA" });
    const out = await runTool(h, "followup_add", { text: "我明天有个面试", personaId: "personaA" });
    assert.ok(out.includes("Already tracking"));
    assert.equal((await h.followupStore.list(false)).length, 1);
  });

  it("list shows active items; delete removes item + retires the rule", async () => {
    const h = makeHarness();
    await runTool(h, "followup_add", { text: "我明天有个面试", personaId: "personaA" });
    const listOut = await runTool(h, "followup_list", { personaId: "personaA" });
    assert.ok(listOut.includes("面试"));
    const items = await h.followupStore.list(false);
    const out = await runTool(h, "followup_delete", { itemId: items[0].id });
    assert.ok(out.includes("Stopped tracking"));
    assert.equal((await h.followupStore.list(false)).length, 0);
    assert.equal(h.retired.length, 1);
    assert.equal(h.retired[0], items[0].ruleId);
    const rule = await h.initiativeStore.get(items[0].ruleId);
    assert.equal(rule?.status, "archived");
  });

  it("set_enabled flips the master toggle and archives/restores rules", async () => {
    const h = makeHarness();
    await runTool(h, "followup_add", { text: "我明天有个面试", personaId: "personaA" });
    const items = await h.followupStore.list(false);
    await runTool(h, "followup_set_enabled", { enabled: false });
    assert.equal(await h.followupStore.isEnabled(), false);
    assert.equal((await h.initiativeStore.get(items[0].ruleId))?.status, "archived");
    await runTool(h, "followup_set_enabled", { enabled: true });
    assert.equal(await h.followupStore.isEnabled(), true);
    assert.equal((await h.initiativeStore.get(items[0].ruleId))?.status, "active");
  });
});

describe("incognito guard (final-audit lesson)", () => {
  it("blocks the three write tools, leaves list readable", () => {
    assert.equal(isBlockedInIncognito("followup_add"), true);
    assert.equal(isBlockedInIncognito("followup_delete"), true);
    assert.equal(isBlockedInIncognito("followup_set_enabled"), true);
    assert.equal(isBlockedInIncognito("followup_list"), false);
  });
});
