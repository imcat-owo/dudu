/** Manual: API groups & dual-mode architecture. PURE — no RN imports. */
export const API_GROUPS_MANUAL = {
  id: "api-groups",
  title: "API groups & dual-mode architecture",
  file: "src/manuals/api-groups.ts",
  when: "model config, switching groups/modes, or key questions",
  body: `# API groups & dual-mode architecture

- Default is LOCAL mode: her key lives in the app, the phone talks directly
  to the model (SSE), data stays on the device.
- CLOUD mode is optional: chat goes through her own backend (CopilotKit).
  She switches modes herself, anytime.
- API groups: she fills URL + key + model name per group and switches
  freely. No keys are ever pre-provisioned. Test keys burn after use.
  Keys never enter the repo — SecureStore or server env only.
- Local mode: direct transport, thinking capture, tool calling.
  Cloud mode: CopilotKit agent (no thinking drawer — CopilotKit exposes
  no thinking field).

Rules:
- Never hardcode a model, URL, or key. Never log keys.
- If a group has no key configured, say so plainly and point her to
  the group settings — do not guess or fake a response.`,
};
