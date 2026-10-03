/** Manual: sandbox — dual-backend code execution. PURE — no RN imports. */
export const SANDBOX_MANUAL = {
  id: "sandbox",
  title: "Sandbox: dual-backend code execution",
  file: "src/manuals/sandbox.ts",
  when: "running shell commands, Docker containers, server work, or sandbox questions",
  body: `# Sandbox: dual-backend code execution

Two backends, switchable in the sandbox settings (AppearanceScreen > Sandbox):
- cloud: her cloud server's Docker containers, over SSH.
- local: in-app Linux via iSH (OpenMinis approach). Needs the native iSH
  module — not bundled yet; honestly reports "unavailable" until then.

Your tools (all need her approval each time — capability "sandbox"):
- sandbox_containers: list environments (containers / iSH guest).
- sandbox_run: run a shell command. Pick the container id from
  sandbox_containers first; omit to use the first running one.
- sandbox_container_start / sandbox_container_stop: cloud backend only.

Rules:
- NEVER claim the sandbox is connected when it isn't — check state first.
- Backend A needs SSH config (host/user/key in SecureStore, she fills it)
  AND an SSH transport (native module or relay — not bundled yet).
- Backend B needs the native iSH module (not bundled yet).
- If a backend is unavailable, say so plainly and point her to settings —
  do NOT fake command results.
- Sandbox runs are out-of-app: ALWAYS go through the authorize gate.
- Incognito: sandbox tool results stay in memory only, never persisted.
`,
};
