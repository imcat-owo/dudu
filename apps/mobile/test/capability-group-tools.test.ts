/**
 * capability_groups_list — read-only AI visibility into "分组"
 * (audit round 2, AI-use P1-2).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCapabilityGroupTools } from "../src/api-groups/capability-group-tools.js";
import { seedCapabilityGroups } from "../src/api-groups/capability-groups.js";
import type { ApiGroup } from "../src/api-groups/types.js";

const PRESET_NAMES: Record<string, string> = {
  image_input: "图片输入",
  image_output: "图片输出",
  video: "视频",
  voice_input: "语音输入",
};

function apiGroup(id: string, name: string, model: string): ApiGroup {
  return {
    id,
    name,
    vendor: "openai",
    baseUrl: "https://api.example.com/v1",
    model,
    headers: {},
    createdAt: 1,
  };
}

function makeTools(groups = seedCapabilityGroups(), apis: ApiGroup[] = [], routing = true) {
  const tools = createCapabilityGroupTools({
    presetName: (id) => PRESET_NAMES[id] ?? id,
    getCapabilityGroups: () => groups,
    getApiGroups: () => apis,
    isRoutingEnabled: () => routing,
  });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "capability_groups_list");
  return tools[0];
}

describe("capability_groups_list", () => {
  it("lists the 4 preset groups, empty by default", async () => {
    const out = await makeTools().run({}, {} as never);
    assert.ok(out.includes("图片输入"), "shows preset display name");
    assert.ok(out.includes("image_input"), "shows the tag");
    assert.ok(out.includes("input"), "shows the kind");
    assert.ok(out.includes("图片输出"));
    assert.ok(out.includes("视频"));
    assert.ok(out.includes("语音输入"));
    assert.ok(out.includes("empty"), "empty groups say so honestly");
    assert.ok(out.includes("routing ON"));
  });

  it("shows members with primary/fallback roles and model overrides", async () => {
    const groups = seedCapabilityGroups();
    groups[0].members = [{ groupId: "g1", model: "gpt-4o-vision" }, { groupId: "g2" }];
    const apis = [apiGroup("g1", "主力", "gpt-4o"), apiGroup("g2", "备用", "claude-3")];
    const out = await makeTools(groups, apis).run({}, {} as never);
    assert.ok(out.includes("primary: 主力 / gpt-4o-vision"), "override model shown");
    assert.ok(out.includes("fallback 1: 备用 / claude-3"), "group default model shown");
  });

  it("marks unknown connections honestly instead of crashing", async () => {
    const groups = seedCapabilityGroups();
    groups[2].members = [{ groupId: "gone" }];
    const out = await makeTools(groups, []).run({}, {} as never);
    assert.ok(out.includes("unknown connection gone"));
  });

  it("reflects the routing flag", async () => {
    const out = await makeTools(seedCapabilityGroups(), [], false).run({}, {} as never);
    assert.ok(out.includes("routing OFF"));
  });

  it("uses her custom rename when set", async () => {
    const groups = seedCapabilityGroups();
    groups[0].name = "看图专用";
    const out = await makeTools(groups, []).run({}, {} as never);
    assert.ok(out.includes("看图专用"));
  });
});
