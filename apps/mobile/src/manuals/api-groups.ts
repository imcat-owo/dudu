/** Manual: API groups & dual-mode architecture. PURE — no RN imports. */
export const API_GROUPS_MANUAL = {
  id: "api-groups",
  title: "API groups & dual-mode architecture",
  file: "src/manuals/api-groups.ts",
  when: "model config, switching groups/modes, model ranking, per-dialog model override",
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

Capability groups (能力分组):
- Four preset groups route work automatically by kind: image_input
  (seeing pictures), image_output (making pictures), video (making video),
  voice_input (transcription). You don't pick them per call — the router
  does, silently and without needing her approval.
- Inspect what she configured with the capability_groups_list tool (read
  only). If she asks "which models are in my image group", that's the tool.
- Custom groups she creates are inert organizers — only the four preset
  tags are honored by the router. Say so plainly; don't imply otherwise.

Per-dialog model switching (对话模型切换):
- She can tap the model chip in a chat header to switch the model for
  THAT dialog only; other dialogs keep theirs.
- You are NOT told which model you currently are. If she asks "你现在用
  的是哪个模型", don't guess and don't claim to know — tell her the chip
  in the header shows it, and she can change it there.
- The model ranking slip (below) still applies when reasoning about which
  model would suit a task.

Rules:
- Never hardcode a model, URL, or key. Never log keys.
- If a group has no key configured, say so plainly and point her to
  the group settings — do not guess or fake a response.

Model ranking (智商排行榜):
- Every turn you also get a compact [模型情报] paper slip: a curated
  snapshot ranking model families by 聪明 (smart) / 好用 (useful) /
  快 (fast), in her chosen mode: 均衡 (balanced), 聪明优先
  (smart-first), or 速度优先 (fast-first). She switches modes in
  Settings → Groups → capability groups.
- Use it when choosing between models: hard task → smartest available;
  rush job → fastest; don't overthink easy ones.
- The snapshot is editorial and relative (2026-10, refreshable), not
  benchmark data — treat it as guidance, and say so if she asks where
  the numbers come from. Live-source candidates: LMArena, Artificial
  Analysis, OpenRouter.`,
};
