/**
 * Capability groups + router tests — PURE modules, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_TAGS,
  type CapabilityGroup,
  capabilityGroupDisplayName,
  moveMember,
  seedCapabilityGroups,
  validateCapabilityGroup,
} from "../src/api-groups/capability-groups.js";
import { createCapabilityStore } from "../src/api-groups/capability-store.js";
import {
  describeVia,
  findCapabilityGroup,
  planVision,
  planVoiceInput,
  resolveMembers,
} from "../src/api-groups/group-router.js";
import type { ApiGroup } from "../src/api-groups/types.js";

function apiGroup(id: string, overrides: Partial<ApiGroup> = {}): ApiGroup {
  return {
    id,
    name: `Group ${id}`,
    vendor: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: `model-${id}`,
    headers: {},
    createdAt: 1,
    ...overrides,
  };
}

function capGroup(overrides: Partial<CapabilityGroup> = {}): CapabilityGroup {
  return {
    id: "cg1",
    name: "",
    tag: CAPABILITY_TAGS.IMAGE_INPUT,
    kind: "input",
    members: [],
    enabled: true,
    createdAt: 1,
    ...overrides,
  };
}

test("seeds the four preset groups, enabled and empty", () => {
  const seeds = seedCapabilityGroups();
  assert.equal(seeds.length, 4);
  const tags = seeds.map((s) => s.tag).sort();
  assert.deepEqual(tags, ["image_input", "image_output", "video", "voice_input"]);
  assert.ok(seeds.every((s) => s.enabled && s.members.length === 0 && s.presetId));
});

test("display name: preset translation unless renamed", () => {
  const g = capGroup({ presetId: "image_input", name: "" });
  assert.equal(
    capabilityGroupDisplayName(g, (id) => `T:${id}`),
    "T:image_input",
  );
  assert.equal(
    capabilityGroupDisplayName(capGroup({ name: "我的图" }), (id) => `T:${id}`),
    "我的图",
  );
});

test("validateCapabilityGroup requires a tag", () => {
  assert.equal(validateCapabilityGroup({ tag: "", name: "" }), "tagRequired");
  assert.equal(validateCapabilityGroup({ tag: "custom-x", name: "" }), null);
});

test("moveMember reorders, primary stays first-eligible", () => {
  const members = [{ groupId: "a" }, { groupId: "b" }, { groupId: "c" }];
  assert.deepEqual(
    moveMember(members, 1, -1).map((m) => m.groupId),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    moveMember(members, 0, 1).map((m) => m.groupId),
    ["b", "a", "c"],
  );
  // Out of bounds = no-op.
  assert.deepEqual(moveMember(members, 0, -1), members);
});

test("resolveMembers keeps order, applies model override, skips missing", () => {
  const groups = [apiGroup("a"), apiGroup("b")];
  const g = capGroup({
    members: [{ groupId: "b", model: "vision-override" }, { groupId: "gone" }, { groupId: "a" }],
  });
  const resolved = resolveMembers(g, groups);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].model, "vision-override");
  assert.equal(resolved[0].apiGroup.id, "b");
  assert.equal(resolved[1].model, "model-a");
});

test("findCapabilityGroup only matches enabled groups", () => {
  const groups = [capGroup({ tag: "image_input", enabled: false })];
  assert.equal(findCapabilityGroup(groups, "image_input"), null);
  const on = [capGroup({ tag: "image_input", enabled: true })];
  assert.equal(findCapabilityGroup(on, "image_input")?.tag, "image_input");
});

test("planVision: native fast path wins, no routing", () => {
  const current = apiGroup("cur", { vision: { native: true } });
  const plan = planVision(current, [], [], true);
  assert.equal(plan.mode, "native");
  assert.equal(plan.mode === "native" && plan.decision.routed, false);
});

test("planVision: current describe config beats routing", () => {
  const current = apiGroup("cur", { vision: { native: false, model: "v" } });
  const routed = capGroup({
    members: [{ groupId: "x" }],
  });
  const plan = planVision(current, [routed], [apiGroup("x")], true);
  assert.equal(plan.mode, "describe-current");
});

test("planVision: no vision config -> routed via group members in order", () => {
  const current = apiGroup("cur");
  const routed = capGroup({
    members: [{ groupId: "x" }, { groupId: "y", model: "y-vision" }],
  });
  const plan = planVision(current, [routed], [apiGroup("x"), apiGroup("y")], true);
  assert.equal(plan.mode, "routed");
  if (plan.mode === "routed") {
    assert.equal(plan.candidates.length, 2);
    assert.equal(plan.candidates[0].model, "model-x");
    assert.equal(plan.candidates[1].model, "y-vision");
    assert.equal(plan.decision.routed, true);
  }
});

test("planVision: routing disabled or empty group -> unavailable", () => {
  const current = apiGroup("cur");
  const routed = capGroup({ members: [{ groupId: "x" }] });
  const p1 = planVision(current, [routed], [apiGroup("x")], false);
  assert.equal(p1.mode, "unavailable");
  const p2 = planVision(current, [capGroup({ members: [] })], [], true);
  assert.equal(p2.mode, "unavailable");
  const p3 = planVision(null, [], [], true);
  assert.equal(p3.mode, "unavailable");
});

test("planVoiceInput: current first, then group members, deduped", () => {
  const current = apiGroup("cur");
  const vgroup = capGroup({
    tag: CAPABILITY_TAGS.VOICE_INPUT,
    members: [{ groupId: "cur" }, { groupId: "s" }],
  });
  const out = planVoiceInput(current, [vgroup], [current, apiGroup("s")], true);
  assert.deepEqual(
    out.map((g) => g.id),
    ["cur", "s"],
  );
});

test("describeVia: null when not routed, trace when routed", () => {
  assert.equal(describeVia({ routed: false, via: "native" }), null);
  const s = describeVia({
    routed: true,
    via: "routed",
    groupName: "图片输入",
    modelName: "gpt-4o",
  });
  assert.ok(s?.includes("gpt-4o") && s?.includes("图片输入"));
});

function memBackend() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

test("capability store: seeds presets, upserts, flags persist", async () => {
  const store = createCapabilityStore(memBackend());
  await store.__resetForTests();
  let snap = store.getSnapshot();
  assert.equal(snap.groups.length, 4);
  assert.equal(snap.routingEnabled, true);
  assert.equal(snap.coordinationEnabled, false);

  // Preset remove = disable, not delete.
  const presetId = snap.groups[0].id;
  await store.remove(presetId);
  snap = store.getSnapshot();
  assert.equal(snap.groups.length, 4);
  assert.equal(snap.groups.find((g) => g.id === presetId)?.enabled, false);

  // Custom group round-trips.
  const custom = store.newCustomGroup("my-tag", "input", "我的组");
  await store.upsert({ ...custom, members: [{ groupId: "g1" }] });
  snap = store.getSnapshot();
  assert.equal(snap.groups.length, 5);
  assert.equal(snap.groups.find((g) => g.id === custom.id)?.members.length, 1);
  await store.remove(custom.id);
  assert.equal(store.getSnapshot().groups.length, 4);

  // Flags.
  await store.setRoutingEnabled(false);
  await store.setCoordinationEnabled(true);
  snap = store.getSnapshot();
  assert.equal(snap.routingEnabled, false);
  assert.equal(snap.coordinationEnabled, true);
});

test("capability store: re-seeds missing presets on load", async () => {
  const backend = memBackend();
  const s1 = createCapabilityStore(backend);
  await s1.__resetForTests();
  // Simulate an old stored payload missing one preset.
  const snap = s1.getSnapshot();
  const partial = snap.groups.filter((g) => g.presetId !== "video");
  await backend.setItem("dudu.capability-groups.v1", JSON.stringify(partial));
  const s2 = createCapabilityStore(backend);
  // Force reload: fresh store reads from backend on construction.
  await new Promise((r) => setTimeout(r, 50));
  const tags = s2.getSnapshot().groups.map((g) => g.presetId ?? g.tag);
  assert.ok(tags.includes("video"), "missing preset re-seeded");
});
