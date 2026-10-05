/**
 * D17 + D20 regression tests for ask_user.
 *
 * D17: ask cards are strictly per-dialog — a question asked in dialog A
 * must never surface in dialog B, and answering in B must never resolve
 * A's request.
 * D20: the 5-minute safety timeout reports honestly instead of claiming
 * she dismissed the question.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  __pendingAskUserCount,
  type AskUserRequest,
  answerAskUserRequest,
  cancelAskUserRequest,
  createAskUserTools,
  subscribeAskUserRequest,
} from "../src/mcp/ask-user";

const Q = { questions: [{ id: "q1", question: "Which?", kind: "single", options: ["A", "B"] }] };

describe("ask-user dialog isolation (D17)", () => {
  it("request carries the owning dialog's threadId", async () => {
    const tools = createAskUserTools({ threadId: "dialog-A" });
    let seen: AskUserRequest | null = null;
    const unsub = subscribeAskUserRequest((req) => {
      seen = req;
    });
    try {
      const p = tools[0].run(Q, {} as never);
      assert.equal(__pendingAskUserCount(), 1);
      assert.ok(seen, "subscriber should have seen the request");
      assert.equal((seen as unknown as AskUserRequest).threadId, "dialog-A");
      answerAskUserRequest((seen as unknown as AskUserRequest).id, { q1: "A" });
      await p;
      assert.equal(__pendingAskUserCount(), 0);
    } finally {
      unsub();
    }
  });

  it("a question asked in A never surfaces in B, and B's answer can't resolve A", async () => {
    const toolsA = createAskUserTools({ threadId: "dialog-A" });
    const seenB: Array<AskUserRequest | null> = [];
    const unsubB = subscribeAskUserRequest(
      (req) => {
        seenB.push(req);
      },
      { threadId: "dialog-B" },
    );
    const seenA: Array<AskUserRequest | null> = [];
    const unsubA = subscribeAskUserRequest(
      (req) => {
        seenA.push(req);
      },
      { threadId: "dialog-A" },
    );
    try {
      const p = toolsA[0].run(Q, {} as never);
      // A asked; A's listener got it, B's listener got nothing.
      assert.equal(seenA.length, 1);
      assert.ok(seenA[0]);
      assert.deepEqual(seenB, []);
      // B has no request id to answer with — but even answering A's id
      // through the module must only clear A's listener.
      const reqA = seenA[0] as AskUserRequest;
      assert.equal(answerAskUserRequest(reqA.id, { q1: "B" }), true);
      await p;
      assert.deepEqual(
        seenA.map((r) => (r ? r.id : null)),
        [reqA.id, null],
      );
      assert.deepEqual(seenB, [], "B must stay completely silent");
      assert.equal(__pendingAskUserCount(), 0);
    } finally {
      unsubA();
      unsubB();
    }
  });

  it("switching dialogs replays only the new dialog's pending request", async () => {
    const toolsA = createAskUserTools({ threadId: "dialog-A" });
    const toolsB = createAskUserTools({ threadId: "dialog-B" });
    const pA = toolsA[0].run(Q, {} as never);
    const pB = toolsB[0].run(Q, {} as never);
    const seen: Array<AskUserRequest | null> = [];
    // Simulate: user opens dialog B (subscribes with B's threadId).
    const unsubB = subscribeAskUserRequest(
      (req) => {
        seen.push(req);
      },
      { threadId: "dialog-B" },
    );
    try {
      // Replay delivers exactly one request: B's, not A's.
      assert.equal(seen.length, 1);
      assert.equal((seen[0] as AskUserRequest).threadId, "dialog-B");
      assert.equal(__pendingAskUserCount(), 2);
      answerAskUserRequest((seen[0] as AskUserRequest).id, { q1: "A" });
      await pB;
      // A's request is still pending, untouched.
      assert.equal(__pendingAskUserCount(), 1);
      // Now simulate switching back to A: replay delivers A's.
      const seen2: Array<AskUserRequest | null> = [];
      const unsubA = subscribeAskUserRequest(
        (req) => {
          seen2.push(req);
        },
        { threadId: "dialog-A" },
      );
      try {
        assert.equal(seen2.length, 1);
        assert.equal((seen2[0] as AskUserRequest).threadId, "dialog-A");
        answerAskUserRequest((seen2[0] as AskUserRequest).id, { q1: "A" });
        await pA;
        assert.equal(__pendingAskUserCount(), 0);
      } finally {
        unsubA();
      }
    } finally {
      unsubB();
    }
  });

  it("legacy callers without threadId keep the old see-everything behavior", async () => {
    const tools = createAskUserTools();
    let seen: AskUserRequest | null = null;
    const unsub = subscribeAskUserRequest((req) => {
      seen = req;
    });
    try {
      const p = tools[0].run(Q, {} as never);
      assert.ok(seen, "unfiltered listener should see unscoped request");
      assert.equal((seen as unknown as AskUserRequest).threadId, "");
      answerAskUserRequest((seen as unknown as AskUserRequest).id, { q1: "A" });
      await p;
    } finally {
      unsub();
    }
  });
});

describe("ask-user timeout honesty (D20)", () => {
  it("timeout cancel reports honestly; plain cancel still means dismissed", async () => {
    const tools = createAskUserTools({ threadId: "t1" });
    let req1: AskUserRequest | null = null;
    let req2: AskUserRequest | null = null;
    const unsub = subscribeAskUserRequest((req) => {
      if (req && req1 === null) req1 = req;
      else if (req) req2 = req;
    });
    try {
      const p1 = tools[0].run(Q, {} as never);
      const p2 = tools[0].run(Q, {} as never);
      assert.ok(req1 && req2);
      assert.equal(cancelAskUserRequest((req1 as AskUserRequest).id, "timeout"), true);
      await assert.rejects(p1, /timed out — she may not have seen it/);
      assert.equal(cancelAskUserRequest((req2 as AskUserRequest).id), true);
      await assert.rejects(p2, /She dismissed the question\./);
      assert.equal(__pendingAskUserCount(), 0);
    } finally {
      unsub();
    }
  });
});
