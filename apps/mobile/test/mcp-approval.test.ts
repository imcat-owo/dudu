/**
 * D13 regression tests: the real in-session MCP tool approval card.
 *
 * Proves:
 * 1. Raising an approval request emits it to the owning dialog's listener
 *    with server/tool identity and an args summary; answering "allow"
 *    resolves the promise with { allowed: true, remember: false }.
 * 2. Dialog isolation: a request raised in dialog A never surfaces in B,
 *    and B's answer can't resolve A's request (D17 contract).
 * 3. "Remember my choice" resolves with remember: true so the provider
 *    persists it into toolApprovals.
 * 4. Dismiss/timeout fails closed (rejects, never resolves allow) with an
 *    honest message — never claims she declined when she didn't.
 * 5. Long args are truncated for the card.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  __pendingMcpApprovalCount,
  answerMcpApprovalRequest,
  cancelMcpApprovalRequest,
  type McpApprovalRequest,
  requestMcpToolApproval,
  subscribeMcpApprovalRequest,
} from "../src/mcp/tool-approval";

function raise(threadId = "dialog-A") {
  return requestMcpToolApproval({
    threadId,
    serverId: "srv-1",
    serverName: "Demo Server",
    toolName: "search",
    args: { q: "hello" },
  });
}

describe("mcp tool approval (D13)", () => {
  it("request emits to the owning dialog; allow resolves with allowed+no-remember", async () => {
    let seen: McpApprovalRequest | null = null;
    const unsub = subscribeMcpApprovalRequest((req) => {
      seen = req;
    });
    try {
      const p = raise("dialog-A");
      assert.equal(__pendingMcpApprovalCount(), 1);
      assert.ok(seen, "subscriber should have seen the request");
      const req = seen as unknown as McpApprovalRequest;
      assert.equal(req.threadId, "dialog-A");
      assert.equal(req.serverId, "srv-1");
      assert.equal(req.serverName, "Demo Server");
      assert.equal(req.toolName, "search");
      assert.ok(req.argsSummary.includes("hello"), "args summary should carry the args");
      assert.equal(answerMcpApprovalRequest(req.id, { allowed: true, remember: false }), true);
      const outcome = await p;
      assert.deepEqual(outcome, { allowed: true, remember: false });
      assert.equal(__pendingMcpApprovalCount(), 0);
    } finally {
      unsub();
    }
  });

  it("deny resolves with allowed=false so the tool is blocked", async () => {
    let seen: McpApprovalRequest | null = null;
    const unsub = subscribeMcpApprovalRequest((req) => {
      seen = req;
    });
    try {
      const p = raise("dialog-A");
      const req = seen as unknown as McpApprovalRequest;
      assert.equal(answerMcpApprovalRequest(req.id, { allowed: false, remember: false }), true);
      const outcome = await p;
      assert.deepEqual(outcome, { allowed: false, remember: false });
    } finally {
      unsub();
    }
  });

  it("remember-my-choice resolves with remember=true for toolApprovals persistence", async () => {
    let seen: McpApprovalRequest | null = null;
    const unsub = subscribeMcpApprovalRequest((req) => {
      seen = req;
    });
    try {
      const p = raise("dialog-A");
      const req = seen as unknown as McpApprovalRequest;
      assert.equal(answerMcpApprovalRequest(req.id, { allowed: true, remember: true }), true);
      const outcome = await p;
      assert.deepEqual(outcome, { allowed: true, remember: true });
    } finally {
      unsub();
    }
  });

  it("isolation: a request in A never surfaces in B, and B's answer can't resolve A", async () => {
    const seenB: Array<McpApprovalRequest | null> = [];
    const unsubB = subscribeMcpApprovalRequest(
      (req) => {
        seenB.push(req);
      },
      { threadId: "dialog-B" },
    );
    const seenA: Array<McpApprovalRequest | null> = [];
    const unsubA = subscribeMcpApprovalRequest(
      (req) => {
        seenA.push(req);
      },
      { threadId: "dialog-A" },
    );
    try {
      const p = raise("dialog-A");
      assert.ok(
        seenA.some((r) => r !== null),
        "A must see its own request",
      );
      assert.ok(
        seenB.every((r) => r === null),
        "B must never see A's request",
      );
      const reqA = seenA.find((r) => r !== null) as unknown as McpApprovalRequest;
      // B answering with a random id must not resolve A's request.
      assert.equal(
        answerMcpApprovalRequest("nonexistent-id", { allowed: true, remember: false }),
        false,
      );
      assert.equal(answerMcpApprovalRequest(reqA.id, { allowed: true, remember: false }), true);
      await p;
      // The clear for A must not wipe B's (null) state weirdly — B saw only nulls.
      assert.ok(seenB.every((r) => r === null));
    } finally {
      unsubA();
      unsubB();
    }
  });

  it("dismiss fails closed with an honest message (never claims she declined)", async () => {
    const unsub = subscribeMcpApprovalRequest(() => {});
    try {
      const p = raise("dialog-A");
      // Grab the pending id via a second subscriber is unnecessary: answer
      // the only pending request through cancel.
      let reqId = "";
      const unsub2 = subscribeMcpApprovalRequest((req) => {
        if (req) reqId = req.id;
      });
      unsub2();
      assert.ok(reqId, "request should be pending");
      assert.equal(cancelMcpApprovalRequest(reqId, "dismissed"), true);
      await assert.rejects(p, /dismissed.*Failing closed/);
      assert.equal(__pendingMcpApprovalCount(), 0);
    } finally {
      unsub();
    }
  });

  it("timeout fails closed with an honest message", async () => {
    const unsub = subscribeMcpApprovalRequest(() => {});
    try {
      const p = raise("dialog-A");
      let reqId = "";
      const unsub2 = subscribeMcpApprovalRequest((req) => {
        if (req) reqId = req.id;
      });
      unsub2();
      assert.equal(cancelMcpApprovalRequest(reqId, "timeout"), true);
      await assert.rejects(p, /timed out.*she may not have seen it/);
    } finally {
      unsub();
    }
  });

  it("long args are truncated for the card; empty args give an empty summary", async () => {
    const seen: McpApprovalRequest[] = [];
    const unsub = subscribeMcpApprovalRequest((req) => {
      if (req) seen.push(req);
    });
    try {
      const p1 = requestMcpToolApproval({
        threadId: "dialog-A",
        serverId: "s",
        serverName: "S",
        toolName: "t",
        args: { blob: "x".repeat(1000) },
      });
      const p2 = requestMcpToolApproval({
        threadId: "dialog-A",
        serverId: "s",
        serverName: "S",
        toolName: "t2",
        args: {},
      });
      assert.equal(seen.length, 2);
      assert.ok(seen[0].argsSummary.length <= 300, "args summary must be truncated");
      assert.equal(seen[1].argsSummary, "");
      answerMcpApprovalRequest(seen[0].id, { allowed: false, remember: false });
      answerMcpApprovalRequest(seen[1].id, { allowed: false, remember: false });
      await p1;
      await p2;
    } finally {
      unsub();
    }
  });
});
