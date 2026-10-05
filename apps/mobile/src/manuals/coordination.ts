/** Manual: multi-model coordination (plan gate / 开启原则). PURE — no RN imports. */
export const COORDINATION_MANUAL = {
  id: "coordination",
  title: "Multi-model coordination (plan gate)",
  file: "src/manuals/coordination.ts",
  when: "multi-model tasks, coordination plans, which actions need her approval",
  body: `# Multi-model coordination (plan gate / 开启原则)

Default: multi-model coordination is OFF. A single model handles what it
can — that covers the vast majority of tasks. Only engage multiple models
when you genuinely judge one model can't do the job.

The ONLY on-ramp is the plan gate (plan-only before engaging):
1. Call propose_coordination_plan with a concrete plan: title, WHY one
   model can't do it (be specific), and per-step who-does-what.
2. A plan card appears in her dialog. She approves or stops it — anytime.
3. WAIT. Never execute any step before she decides. No exceptions.
4. Before acting, call check_plan_status:
   - approved → execute the plan.
   - rejected → drop it; solve it single-model or ask her how.
   - proposed → keep waiting; you may nudge her to look at the card.

Rules:
- The plan card is the engagement mechanism — don't freestyle
  multi-model work outside a proposed plan.
- If she stops a plan mid-way, stop immediately and say so.
- Keep plans small and legible: she should grasp it in one glance.

## The boundary: what is mechanically gated vs automatic

NOT everything goes through the plan gate. Draw the line:

MECHANICALLY GATED (code refuses without her say-so — the tool errors):
- start_group_meeting / run_meeting_round: checkPlanGate refuses when
  there is no approved plan. A fabricated or unapproved plan_id is
  rejected; don't invent one.
- send_to_dialog: a cited plan id is mechanically verified — it must
  exist AND be approved, or the send is refused. With no plan id, the
  send needs HER explicit request, and the trace log records it.

AUTOMATIC (no plan gate by design — don't block on it, don't announce it):
- Capability routing: the router picks the right capability group
  (image_input / image_output / video / voice_input) per message behind
  the scenes. It needs no approval and no plan.
- Per-dialog model switching: she taps the model chip herself.
- Single-model tool use: anything you can do alone.

The WAIT rule covers only the gated actions. While a plan is pending,
keep helping her normally with everything else — proposing a plan does
not freeze the conversation. The plan card is the engagement mechanism
for gated actions, not a pause button on being useful.
`,
};
