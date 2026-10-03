/**
 * Skills (本事包） — pure logic tests. No react-native imports;
 * the store and tools are plain TypeScript.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SKILLS_MANUAL } from "../src/manuals/skills.js";
import { getManual } from "../src/manuals/index.js";
import { normalizeSkill, seedExampleSkills, SkillStore, type SkillStorage } from "../src/skills/store.js";
import { createSkillTools } from "../src/skills/tools.js";

function fakeStorage(): SkillStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

describe("SkillStore", () => {
  it("seeds 2 example skills on first run, idempotent", async () => {
    const store = new SkillStore(fakeStorage());
    const first = await store.listSkills();
    assert.equal(first.length, 2);
    assert.ok(first.every((s) => s.isExample));
    const second = await store.listSkills();
    assert.equal(second.length, 2);
  });

  it("creates, reads, updates, deletes", async () => {
    const store = new SkillStore(fakeStorage());
    const created = await store.createSkill({
      name: "测试本事",
      description: "测试用",
      instructions: "# 步骤\n1. 先这样",
      createdBy: "her",
    });
    assert.equal(created.name, "测试本事");
    assert.equal(created.enabled, true);

    const got = await store.getSkill(created.id);
    assert.equal(got?.instructions, "# 步骤\n1. 先这样");

    const updated = await store.updateSkill(created.id, { description: "改过了" });
    assert.equal(updated?.description, "改过了");

    assert.equal(await store.deleteSkill(created.id), true);
    assert.equal(await store.getSkill(created.id), null);
  });

  it("rejects empty and overlong names", async () => {
    const store = new SkillStore(fakeStorage());
    await assert.rejects(() => store.createSkill({ name: "  ", createdBy: "her" }));
    await assert.rejects(() => store.createSkill({ name: "x".repeat(41), createdBy: "her" }));
  });

  it("setEnabled toggles, listEnabled filters", async () => {
    const store = new SkillStore(fakeStorage());
    await store.listSkills(); // seed
    const all = await store.listSkills();
    const first = all[0];
    await store.setEnabled(first.id, false);
    const enabled = await store.listEnabled();
    assert.ok(!enabled.some((s) => s.id === first.id));
  });

  it("buildSkillIndex is token-minimal and skips disabled", async () => {
    const store = new SkillStore(fakeStorage());
    await store.listSkills();
    const all = await store.listSkills();
    await store.setEnabled(all[0].id, false);
    const index = await store.buildSkillIndex();
    assert.ok(index.includes("skill:"));
    assert.ok(!index.includes(all[0].name));
    assert.ok(index.includes(all[1].name));
  });

  it("normalizeSkill is defensive", () => {
    const s = normalizeSkill({} as never);
    assert.equal(s.name, "");
    assert.equal(s.enabled, true);
    assert.equal(s.createdBy, "her");
  });
});

describe("seed examples", () => {
  it("are honest and marked", () => {
    const seeds = seedExampleSkills();
    assert.equal(seeds.length, 2);
    assert.ok(seeds.every((s) => s.isExample));
    assert.ok(seeds.some((s) => s.name === "旅行规划"));
  });
});

describe("skill tools", () => {
  it("all 5 tool names are registered once", () => {
    const tools = createSkillTools(new SkillStore(fakeStorage()));
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["skill_create", "skill_delete", "skill_list", "skill_read", "skill_update"]);
  });

  it("create → list → read → delete roundtrip via tools", async () => {
    const store = new SkillStore(fakeStorage());
    const tools = createSkillTools(store);
    const byName = (n: string) => {
      const tool = tools.find((t) => t.name === n);
      assert.ok(tool, `tool ${n} exists`);
      return tool;
    };

    const created = await byName("skill_create").run(
      { name: "做饭", description: "做饭偏好", instructions: "少油少盐" },
      {} as never,
    );
    assert.ok(created.includes("做饭"));

    const listed = await byName("skill_list").run({}, {} as never);
    assert.ok(listed.includes("做饭"));

    const all = await store.listSkills();
    const mine = all.find((s) => s.name === "做饭");
    assert.ok(mine, "created skill found");
    const read = await byName("skill_read").run({ id: mine.id }, {} as never);
    assert.ok(read.includes("少油少盐"));

    const del = await byName("skill_delete").run({ id: mine.id }, {} as never);
    assert.ok(del.includes("已删除"));
  });

  it("read of missing skill is honest", async () => {
    const tools = createSkillTools(new SkillStore(fakeStorage()));
    const read = tools.find((t) => t.name === "skill_read");
    assert.ok(read, "skill_read exists");
    const out = await read.run({ id: "nope" }, {} as never);
    assert.ok(out.includes("找不到"));
  });

  it("every skill tool manualId resolves in the registry", () => {
    const tools = createSkillTools(new SkillStore(fakeStorage()));
    for (const tool of tools) {
      assert.ok(tool.manualId, `${tool.name} missing manualId`);
      const manualId: string | undefined = tool.manualId;
      assert.ok(manualId && getManual(manualId), `${tool.name}: manual ${tool.manualId} not registered`);
    }
  });
});

describe("skills manual", () => {
  it("is registered", () => {
    assert.equal(SKILLS_MANUAL.id, "skills");
    assert.equal(getManual("skills")?.id, "skills");
  });
});
