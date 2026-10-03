import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CAPABILITY_ORDER,
  buildCapabilityPromptSection,
  CAPABILITIES,
  CAPABILITY_ORDER,
  isCapabilityId,
} from "../src/capabilities.js";

describe("capability registry", () => {
  it("covers the 5 device capabilities + sandbox as AI-only", () => {
    assert.deepEqual(CAPABILITY_ORDER, [
      "bluetooth",
      "photos",
      "location",
      "clipboard",
      "notifications",
    ]);
    assert.deepEqual(AI_CAPABILITY_ORDER, [...CAPABILITY_ORDER, "sandbox"]);
    assert.equal(Object.keys(CAPABILITIES).length, 6);
  });

  it("every capability is out-of-app scope (the AI must ask her)", () => {
    for (const id of AI_CAPABILITY_ORDER) {
      assert.equal(CAPABILITIES[id].scope, "out-of-app", id);
      assert.equal(CAPABILITIES[id].id, id);
    }
  });

  it("every capability has name/ai-description/why i18n keys", () => {
    for (const id of AI_CAPABILITY_ORDER) {
      const def = CAPABILITIES[id];
      assert.ok(def.nameKey.startsWith("perm."), id);
      assert.ok(def.aiDescriptionKey.startsWith("perm.aiDesc."), id);
      assert.ok(def.whyKey.startsWith("perm.why."), id);
    }
  });

  it("sandbox is not a device permission (has its own UI)", () => {
    assert.ok(!(CAPABILITY_ORDER as string[]).includes("sandbox"));
  });
});

describe("isCapabilityId", () => {
  it("accepts the 6 ids, rejects everything else", () => {
    for (const id of AI_CAPABILITY_ORDER) assert.ok(isCapabilityId(id));
    assert.ok(!isCapabilityId("audio"));
    assert.ok(!isCapabilityId(""));
    assert.ok(!isCapabilityId(null));
    assert.ok(!isCapabilityId(undefined));
    assert.ok(!isCapabilityId("PHOTOS"));
  });
});

describe("buildCapabilityPromptSection", () => {
  it("renders one line per AI capability with resolved strings", () => {
    const resolve = (key: string) => `[${key}]`;
    const section = buildCapabilityPromptSection(resolve as never);
    const lines = section.split("\n");
    assert.equal(lines.length, 6);
    for (const id of AI_CAPABILITY_ORDER) {
      const line = lines.find((l) => l.includes(`perm.kind.${id}`));
      assert.ok(line, `missing line for ${id}`);
      assert.ok(line.includes(`perm.aiDesc.${id}`), `missing description for ${id}`);
    }
  });
});
