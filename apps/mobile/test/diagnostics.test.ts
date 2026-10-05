/**
 * D23: clearDiagEntries(groupId) clears only that group's entries.
 *
 * The per-group diagnostics viewer filters to one group; its Clear button
 * must not wipe other groups' logs.
 */
import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  __resetDiagForTests,
  clearDiagEntries,
  listDiagEntries,
  logDiag,
} from "../src/api-groups/diagnostics.js";

function entry(groupId: string) {
  return {
    at: Date.now(),
    kind: "test",
    groupId,
    groupName: groupId,
    request: {
      url: "https://example.test/v1/chat",
      model: "m",
      messageCount: 1,
      bodyBytes: 10,
      bodyPreview: "{}",
    },
    response: { ok: true, ms: 5 },
  };
}

describe("clearDiagEntries (D23)", () => {
  beforeEach(async () => {
    await __resetDiagForTests();
  });

  it("clears only the given group's entries when groupId is passed", async () => {
    await logDiag(entry("g1"));
    await logDiag(entry("g2"));
    await logDiag(entry("g1"));
    await clearDiagEntries("g1");
    const rest = await listDiagEntries();
    assert.deepEqual(
      rest.map((e) => e.groupId),
      ["g2"],
    );
  });

  it("clears everything when no groupId is passed", async () => {
    await logDiag(entry("g1"));
    await logDiag(entry("g2"));
    await clearDiagEntries();
    assert.deepEqual(await listDiagEntries(), []);
  });

  it("clearing an unknown group leaves everything intact", async () => {
    await logDiag(entry("g1"));
    await logDiag(entry("g2"));
    await clearDiagEntries("nope");
    assert.equal((await listDiagEntries()).length, 2);
  });
});
