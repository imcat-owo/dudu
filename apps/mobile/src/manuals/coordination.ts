/** Manual: multi-model coordination (plan gate / 开启原则). PURE — no RN imports. */
export const COORDINATION_MANUAL = {
  id: "coordination",
  title: "Multi-model coordination (plan gate)",
  file: "src/manuals/coordination.ts",
  when: "using more than one model for a task, or proposing a coordination plan",
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
`,
};
