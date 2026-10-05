/**
 * D4: resolveEffectiveGroup — the single source of truth for "which group
 * answers this dialog". The header chip, the chat send gates, the queue
 * gate, and the message "model · time" meta must all agree with the
 * agent's per-turn getGroup.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEffectiveGroup } from "../src/api-groups/dialog-model-override";
import type { ApiGroup } from "../src/api-groups/types";

function group(id: string, model = `model-${id}`): ApiGroup {
  return {
    id,
    name: `Group ${id}`,
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model,
    headers: {},
  } as ApiGroup;
}

const groups = [group("g1"), group("g2")];
const active = groups[0];

describe("resolveEffectiveGroup", () => {
  it("override wins over the global active group", () => {
    const eff = resolveEffectiveGroup("g2", groups, active);
    assert.equal(eff?.id, "g2");
    assert.equal(eff?.model, "model-g2");
  });

  it("falls back to the global active group when no override is set", () => {
    assert.equal(resolveEffectiveGroup(null, groups, active)?.id, "g1");
  });

  it("falls back to active when the override points at a deleted group", () => {
    assert.equal(resolveEffectiveGroup("gone", groups, active)?.id, "g1");
  });

  it("returns null when there is no override and no active group", () => {
    assert.equal(resolveEffectiveGroup(null, groups, null), null);
  });

  it("returns null when groups are empty", () => {
    assert.equal(resolveEffectiveGroup(null, [], null), null);
  });

  it("override to the same group as active still resolves", () => {
    assert.equal(resolveEffectiveGroup("g1", groups, active)?.id, "g1");
  });
});
