/**
 * D21: withToolApproval writes the same `toolApprovals` record the MCP
 * provider reads (provider.ts getApproval) and the D13 approval card
 * writes into via "remember my choice".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withToolApproval } from "../src/mcp/tool-approval-edit.js";
import type { McpServerConfig } from "../src/mcp/types.js";

function server(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "s1",
    name: "S",
    transport: "http",
    url: "https://example.test/mcp",
    enabled: true,
    ...over,
  };
}

describe("withToolApproval (D21)", () => {
  it("sets allow/deny overrides in toolApprovals", () => {
    const out = withToolApproval(server(), "search", "allow");
    assert.equal(out.toolApprovals?.search, "allow");
    const out2 = withToolApproval(server(), "fetch", "deny");
    assert.equal(out2.toolApprovals?.fetch, "deny");
  });

  it("removes the override when set back to ask (the provider default)", () => {
    const s = server({ toolApprovals: { search: "allow", fetch: "deny" } });
    const out = withToolApproval(s, "search", "ask");
    assert.ok(!("search" in (out.toolApprovals ?? {})), "ask override must be removed");
    assert.equal(out.toolApprovals?.fetch, "deny", "other overrides must survive");
  });

  it("does not mutate the original server config", () => {
    const s = server();
    withToolApproval(s, "search", "deny");
    assert.equal(s.toolApprovals, undefined);
  });

  it("matches the provider's read contract (toolApprovals?.[name] ?? 'ask')", () => {
    const s = withToolApproval(server(), "search", "deny");
    const read = (name: string) => s.toolApprovals?.[name] ?? "ask";
    assert.equal(read("search"), "deny");
    assert.equal(read("unset-tool"), "ask");
  });
});
