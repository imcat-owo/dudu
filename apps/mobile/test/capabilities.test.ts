import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCapabilityPromptSection,
  CAPABILITIES,
  CAPABILITY_ORDER,
  isCapabilityId,
} from "../src/capabilities.js";

describe("capability registry", () => {
  it("covers exactly the 5 out-of-app capabilities", () => {
    assert.deepEqual(CAPABILITY_ORDER, [
      "bluetooth",
      "photos",
      "location",
      "clipboard",
      "notifications",
    ]);
    assert.equal(Object.keys(CAPABILITIES).length, 5);
  });

  it("every capability is out-of-app scope (the AI must ask her)", () => {
    for (const id of CAPABILITY_ORDER) {
      assert.equal(CAPABILITIES[id].scope, "out-of-app", id);
      assert.equal(CAPABILITIES[id].id, id);
    }
  });

  it("every capability has name/ai-description/why i18n keys", () => {
    for (const id of CAPABILITY_ORDER) {
      const def = CAPABILITIES[id];
      assert.ok(def.nameKey.startsWith("perm."), id);
      assert.ok(def.aiDescriptionKey.startsWith("perm.aiDesc."), id);
      assert.ok(def.whyKey.startsWith("perm.why."), id);
    }
  });
});

describe("isCapabilityId", () => {
  it("accepts the 5 ids, rejects everything else", () => {
    for (const id of CAPABILITY_ORDER) assert.ok(isCapabilityId(id));
    assert.ok(!isCapabilityId("audio"));
    assert.ok(!isCapabilityId(""));
    assert.ok(!isCapabilityId(null));
    assert.ok(!isCapabilityId(undefined));
    assert.ok(!isCapabilityId("PHOTOS"));
  });
});

describe("buildCapabilityPromptSection", () => {
  it("renders one line per capability with resolved strings", () => {
    const resolve = (key: string) => `[${key}]`;
    const section = buildCapabilityPromptSection(resolve as never);
    const lines = section.split("\n");
    assert.equal(lines.length, 5);
    for (const id of CAPABILITY_ORDER) {
      const line = lines.find((l) => l.includes(`perm.kind.${id}`));
      assert.ok(line, `missing line for ${id}`);
      assert.ok(line.includes(`perm.aiDesc.${id}`), `missing description for ${id}`);
    }
  });
});
