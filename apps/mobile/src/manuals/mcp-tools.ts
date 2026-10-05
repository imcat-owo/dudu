/** Manual: local tool calling (MCP-style). PURE — no RN imports. */
export const MCP_TOOLS_MANUAL = {
  id: "mcp-tools",
  title: "Local tool calling",
  file: "src/manuals/mcp-tools.ts",
  when: "using tools, adding a new tool, or when a tool call fails",
  body: `# Local tool calling (MCP-style)

Local mode supports OpenAI function calling:
- Tools are defined in api-groups/local-tools.ts (createLocalTools) and run
  through ToolRegistry.execute. Definitions go out with the chat request.
- After each model turn, tool calls execute and results feed back as
  role:"tool" messages; the loop continues until the model stops calling.
- Loop cap is MAX_TOOL_ITERATIONS (10) — the loop always terminates.
- Unknown tools, bad arguments, and auth denials become tool ERRORS the
  model sees. Nothing is ever silently dropped.

Rules:
- Every registered tool must REALLY work — no stubs, no fake data.
- Out-of-app tools carry a capability id and go through her authorization
  gate first; denial is a tool error, not a retry loop.
- External MCP servers: the remote transports (Streamable HTTP + legacy
  SSE) ARE implemented (mcp/transports.ts) and wired through the MCP client
  — she adds servers in Settings, tools appear as mcp__<server>__<tool>.
  stdio is NOT available (a phone app can't spawn subprocesses).
  Never claim stdio works.`,
};
