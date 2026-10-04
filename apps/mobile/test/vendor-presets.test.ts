import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankGroup, VENDOR_PRESETS } from "../src/api-groups/types.js";

describe("VENDOR_PRESETS (P1-7: no dead vendor tabs)", () => {
  it("only offers OpenAI-compatible vendors", () => {
    const vendors = VENDOR_PRESETS.map((p) => p.vendor).sort();
    assert.deepEqual(vendors, ["custom", "openai"]);
  });

  it("blankGroup falls back to a real preset", () => {
    // Legacy stored vendors must still resolve to something usable.
    for (const v of ["openai", "custom", "anthropic", "gemini"] as const) {
      const g = blankGroup(v);
      assert.ok(g.baseUrl !== undefined, `blankGroup(${v}) resolves`);
    }
    assert.equal(blankGroup().vendor, "custom");
  });
});
