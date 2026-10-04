import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canOpenDetail } from "../src/local-detail-routing.js";
import type { Detail } from "../src/workspace.js";

describe("canOpenDetail (P1-2: trace openable in local mode)", () => {
  it("opens the cross-dialog trace sheet", () => {
    const d: Detail = { type: "crossDialogTrace" };
    assert.equal(canOpenDetail(d), true);
  });

  it("ignores detail types the local shell cannot render (no dead opens)", () => {
    const others: Detail[] = [
      { type: "mail", mail: {} as never },
      { type: "menu" },
      { type: "notifications" },
      { type: "computer" },
    ];
    for (const d of others) assert.equal(canOpenDetail(d), false);
  });
});
