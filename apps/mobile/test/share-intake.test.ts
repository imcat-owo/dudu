/**
 * B2: share-extension intake routing tests.
 * routePendingShare is pure (no native modules) — the local-path intake
 * logic is unit-testable. consumePendingShare is best-effort: with no
 * DuduSharedData native module it must no-op, never throw.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumePendingShare,
  type PendingShare,
  routePendingShare,
} from "../src/platform/share-intake.js";

function textShare(text: string): PendingShare {
  return { items: [{ kind: "text", value: text }], receivedAt: 0 };
}

describe("routePendingShare", () => {
  it("returns false and never asks when nothing is pending", () => {
    let called = 0;
    assert.equal(
      routePendingShare(null, () => {
        called++;
      }),
      false,
    );
    assert.equal(called, 0);
  });

  it("routes text into ask", () => {
    const seen: string[] = [];
    assert.equal(
      routePendingShare(textShare("hello"), (t) => seen.push(t)),
      true,
    );
    assert.deepEqual(seen, ["hello"]);
  });

  it("routes url as text", () => {
    const seen: string[] = [];
    const share: PendingShare = {
      items: [{ kind: "url", value: "https://example.com" }],
      receivedAt: 0,
    };
    assert.equal(
      routePendingShare(share, (t) => seen.push(t)),
      true,
    );
    assert.deepEqual(seen, ["https://example.com"]);
  });

  it("notes attachments when there is no text", () => {
    const seen: string[] = [];
    const share: PendingShare = {
      items: [{ kind: "image", value: "", filePath: "/shared/a.jpg", fileName: "a.jpg" }],
      receivedAt: 0,
    };
    assert.equal(
      routePendingShare(share, (t) => seen.push(t)),
      true,
    );
    assert.equal(seen.length, 1);
    assert.match(seen[0], /1 attachment\(s\) saved to the shared container/);
  });

  it("returns false and never asks for an empty share", () => {
    let called = 0;
    assert.equal(
      routePendingShare({ items: [], receivedAt: 0 }, () => {
        called++;
      }),
      false,
    );
    assert.equal(called, 0);
  });
});

describe("consumePendingShare", () => {
  it("no-ops without the native module (never throws)", async () => {
    let called = 0;
    const ok = await consumePendingShare(() => {
      called++;
    });
    assert.equal(ok, false);
    assert.equal(called, 0);
  });
});
