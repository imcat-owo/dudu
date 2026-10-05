/**
 * B2: share-extension intake routing tests.
 * routePendingShare is pure (no native modules) — the local-path intake
 * logic is unit-testable. consumePendingShare is best-effort: with no
 * DuduSharedData native module it must no-op, never throw.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  __sharedForTests,
  consumePendingShare,
  type PendingShare,
  routePendingShare,
  takePendingShare,
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

describe("takePendingShare poison-pill guard", () => {
  const KEY = __sharedForTests.SHARED_KEYS.pendingShare;
  const N = __sharedForTests.POISON_DROP_AFTER_FAILURES;

  function makeFakeModule(initial: string | null) {
    let stored: string | null = initial;
    return {
      fake: {
        getString: async (key: string) => (key === KEY ? stored : null),
        remove: async (key: string) => {
          if (key === KEY) stored = null;
        },
        getSharedFilePath: async () => null,
      },
      peek: () => stored,
      write: (raw: string | null) => {
        stored = raw;
      },
    };
  }

  function captureWarn() {
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    return {
      lines,
      restore: () => {
        console.warn = orig;
      },
    };
  }

  it("drops a poisoned payload after N consecutive failures and logs once", async () => {
    const { fake, peek } = makeFakeModule('{"items":"not-an-array"}');
    const { lines, restore } = captureWarn();
    try {
      __sharedForTests.__setModule(fake);
      __sharedForTests.__resetPoisonGuard();
      // First N-1 attempts: null, key stays (retry allowed).
      for (let i = 0; i < N - 1; i++) {
        assert.equal(await takePendingShare(), null);
        assert.notEqual(peek(), null, `poisoned key must survive attempt ${i + 1}`);
      }
      assert.equal(lines.length, 0);
      // Nth attempt: key dropped, one log line.
      assert.equal(await takePendingShare(), null);
      assert.equal(peek(), null, "poisoned key must be deleted after N failures");
      assert.equal(lines.length, 1);
      assert.match(lines[0], /dropping poisoned share payload/);
      // No infinite retry: further takes are plain nulls, no more logs.
      assert.equal(await takePendingShare(), null);
      assert.equal(lines.length, 1);
    } finally {
      restore();
      __sharedForTests.__resetModule();
      __sharedForTests.__resetPoisonGuard();
    }
  });

  it("counts non-JSON payloads as failures too", async () => {
    const { fake, peek } = makeFakeModule("definitely not json{{{");
    const { lines, restore } = captureWarn();
    try {
      __sharedForTests.__setModule(fake);
      __sharedForTests.__resetPoisonGuard();
      for (let i = 0; i < N; i++) {
        assert.equal(await takePendingShare(), null);
      }
      assert.equal(peek(), null);
      assert.equal(lines.length, 1);
    } finally {
      restore();
      __sharedForTests.__resetModule();
      __sharedForTests.__resetPoisonGuard();
    }
  });

  it("resets the failure counter on a successful take", async () => {
    const { fake, peek, write } = makeFakeModule('{"items":"nope"}');
    const { lines, restore } = captureWarn();
    try {
      __sharedForTests.__setModule(fake);
      __sharedForTests.__resetPoisonGuard();
      // N-1 failures build the counter...
      for (let i = 0; i < N - 1; i++) {
        assert.equal(await takePendingShare(), null);
      }
      assert.notEqual(peek(), null);
      // ...then a good payload succeeds and resets it...
      write(JSON.stringify({ items: [{ kind: "text", value: "hi" }], receivedAt: 1 }));
      const got = await takePendingShare();
      assert.deepEqual(got?.items, [{ kind: "text", value: "hi" }]);
      assert.equal(peek(), null, "good payload must be consumed and removed");
      // ...so a fresh poisoned payload gets the full N attempts again.
      write('{"items":42}');
      for (let i = 0; i < N - 1; i++) {
        assert.equal(await takePendingShare(), null);
        assert.notEqual(peek(), null, `counter must have reset (attempt ${i + 1})`);
      }
      assert.equal(lines.length, 0, "no drop log before N failures");
    } finally {
      restore();
      __sharedForTests.__resetModule();
      __sharedForTests.__resetPoisonGuard();
    }
  });
});
