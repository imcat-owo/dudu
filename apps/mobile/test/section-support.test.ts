import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { supportsSection } from "../src/section-support.js";

describe("supportsSection (P1-1: no dead navigation buttons)", () => {
  it("undefined supportedSections = all sections supported (cloud shell)", () => {
    assert.equal(supportsSection(undefined, "goals"), true);
    assert.equal(supportsSection(undefined, "chat"), true);
  });

  it("returns true when the section is in the list", () => {
    assert.equal(supportsSection(["chat", "goals"], "goals"), true);
  });

  it("returns false when the section is missing (local shell has no goals)", () => {
    assert.equal(
      supportsSection(["chat", "space", "connections", "appearance"], "goals"),
      false,
    );
  });

  it("still supports the sections the local shell does host", () => {
    const local = ["chat", "space", "connections", "appearance"] as const;
    for (const s of local) assert.equal(supportsSection([...local], s), true);
  });
});
