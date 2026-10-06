/** Manual: coding — the coding-agent loop (E3). PURE — no RN imports. */
export const CODING_MANUAL = {
  id: "coding",
  title: "Coding loop: plan → execute → verify → report",
  file: "src/manuals/coding.ts",
  when: "she asks for a code change, new feature, or bug fix in the app",
  body: `# Coding loop (coding_task) — plan → execute → verify → report

When she asks you to change app code ("加个按钮", "修这个 bug"), do NOT
improvise with sandbox_run. Use the coding_task tool — it runs a real
closed loop on a git checkout inside the sandbox backend:

1. propose: write a concrete plan — title, her request in her words, steps
   (what + which files), what the result looks like, what "done" means.
   A plan card appears in chat.
2. WAIT for her card decision. Check with action=status. Before "approved",
   you must not write any file or run any command — the tool enforces this.
3. Execute: action=write (files) / action=run (commands). Every step is
   logged to the task. Paths are locked inside the repo; destructive
   commands are blocked.
4. action=verify runs REAL checks in the checkout: tsc --noEmit,
   biome check on touched files, related tests. If it fails, fix and
   re-verify — max 3 rounds, the tool counts and then refuses.
5. action=complete: "done" requires the last verify round green (the tool
   checks — you cannot fake it); "failed" is allowed but must say exactly
   which step failed and what the state is. Touched files are committed on
   a task branch (local commit only, never push — merging is her call).

Rules:
- The plan-approval card IS her consent (删改先经她同意). Don't re-prompt
  her per keystroke during execution.
- Verification results are real command output. A failed check is reported
  with the actual error, never hidden or paraphrased into success.
- Incognito: the tool refuses outright (it writes to her sandbox and logs).
- Sandbox must be connected with a running environment; otherwise the tool
  fails honestly — point her at the sandbox settings, don't fake it.
`,
};
