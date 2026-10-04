/**
 * Plan gate for multi-model coordination (开启原则, vision doc).
 *
 * The principle: multi-model coordination is OFF by default. A single
 * model handles what it can; the AI only engages multiple models when it
 * judges it necessary — and BEFORE engaging, it must show the plan
 * (plan-only) so she can see it and stop it anytime.
 *
 * Flow:
 *  1. AI calls propose_coordination_plan -> plan stored as "proposed",
 *     a PlanGateCard appears in chat.
 *  2. She taps 批准 (approve) or 不用了 (reject) on the card — anytime.
 *  3. AI calls check_plan_status before doing any multi-model step.
 *     "approved" -> execute; anything else -> do NOT execute.
 *
 * Plans are per-thread and in-memory (a proposed plan is an ephemeral
 * conversational artifact; it dies with the app session — documented, not
 * hidden). Proposing a new plan supersedes an older proposed one in the
 * same thread.
 *
 * PURE module: no React Native / expo imports.
 */

/**
 * "superseded": replaced by a newer proposal in the same thread — NOT her
 * rejection. check_plan_status reports this distinctly so the AI never
 * claims "she stopped it" when she simply got a newer plan.
 */
export type CoordinationPlanStatus = "proposed" | "approved" | "rejected" | "superseded";

export interface CoordinationPlanStep {
  /** Stable key for the plan card (assigned at propose time). */
  id: string;
  title: string;
  detail?: string;
}

export interface CoordinationPlan {
  id: string;
  threadId: string;
  title: string;
  reason: string;
  steps: CoordinationPlanStep[];
  status: CoordinationPlanStatus;
  createdAt: number;
}

export interface ProposePlanInput {
  title: string;
  reason: string;
  /** Steps as the caller provides them; the store assigns stable step ids. */
  steps: Array<{ title: string; detail?: string }>;
}

/** Validation shared by the tool and tests. Returns an error key or null. */
export function validatePlanInput(input: {
  title?: unknown;
  reason?: unknown;
  steps?: unknown;
}): string | null {
  if (typeof input.title !== "string" || !input.title.trim()) return "titleRequired";
  if (typeof input.reason !== "string" || !input.reason.trim()) return "reasonRequired";
  if (!Array.isArray(input.steps) || input.steps.length === 0) return "stepsRequired";
  for (const s of input.steps) {
    if (typeof s !== "object" || s === null) return "stepsInvalid";
    const t = (s as { title?: unknown }).title;
    if (typeof t !== "string" || !t.trim()) return "stepsInvalid";
  }
  return null;
}

export function createPlanGateStore() {
  const plans = new Map<string, CoordinationPlan>();
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  function activeIn(threadId: string): CoordinationPlan | null {
    let latest: CoordinationPlan | null = null;
    for (const p of plans.values()) {
      if (p.threadId === threadId && p.status === "proposed") {
        if (!latest || p.createdAt > latest.createdAt) latest = p;
      }
    }
    return latest;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): { plans: CoordinationPlan[] } {
      return { plans: [...plans.values()] };
    },

    /** The currently-proposed (awaiting her decision) plan for a thread. */
    activePlanFor(threadId: string): CoordinationPlan | null {
      return activeIn(threadId);
    },

    getPlan(planId: string): CoordinationPlan | null {
      return plans.get(planId) ?? null;
    },

    propose(threadId: string, input: ProposePlanInput): CoordinationPlan {
      // A new proposal supersedes any still-pending one in this thread —
      // she only ever sees one live plan card.
      const prev = activeIn(threadId);
      if (prev) {
        plans.set(prev.id, { ...prev, status: "superseded" });
      }
      const plan: CoordinationPlan = {
        id: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        threadId,
        title: input.title.trim(),
        reason: input.reason.trim(),
        steps: input.steps.map((s, i) => ({
          id: `step_${i + 1}`,
          title: s.title.trim(),
          detail: s.detail?.trim() || undefined,
        })),
        status: "proposed",
        createdAt: Date.now(),
      };
      plans.set(plan.id, plan);
      // P3: bound the app-wide history — prune oldest non-proposed first.
      if (plans.size > 20) {
        const prunable = [...plans.values()]
          .filter((q) => q.id !== plan.id && q.status !== "proposed")
          .sort((a, b) => a.createdAt - b.createdAt);
        for (let i = 0; i < plans.size - 20 && i < prunable.length; i++) {
          plans.delete(prunable[i].id);
        }
      }
      emit();
      return plan;
    },

    /** Her decision on the card. Returns false when the plan is unknown. */
    decide(planId: string, approved: boolean): boolean {
      const p = plans.get(planId);
      if (p?.status !== "proposed") return false;
      plans.set(planId, { ...p, status: approved ? "approved" : "rejected" });
      emit();
      return true;
    },

    /** Test hook. */
    __resetForTests(): void {
      plans.clear();
      emit();
    },
  };
}

export type PlanGateStore = ReturnType<typeof createPlanGateStore>;

/** App-wide singleton. */
export const planGateStore = createPlanGateStore();
