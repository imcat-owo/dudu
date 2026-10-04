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
 * Plans are per-thread. Approved plans (and still-pending proposals) are
 * persisted so an in-flight meeting survives an app restart: the plan gate
 * re-checks the plan before every round, and a missing plan used to brick
 * the meeting with a confusing error (P1-9). Proposed plans are conversational
 * cards — persisting them also lets her still approve/decline after a restart.
 * Proposing a new plan supersedes an older proposed one in the same thread.
 *
 * PURE module: no React Native / expo imports. Persistence is injected
 * (AsyncStorage in production via plan-gate-instance.ts, fake in tests).
 */

/**
 * "superseded": replaced by a newer proposal in the same thread — NOT her
 * rejection. check_plan_status reports this distinctly so the AI never
 * claims "she stopped it" when she simply got a newer plan.
 */
export type CoordinationPlanStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded"
  | "consumed"
  | "revoked";

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
  /** P2-9: which meeting spent this approval. Rounds of that same meeting
   * keep passing the per-round plan re-check; a different meeting may not. */
  consumedByMeetingId?: string;
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

/** Shape guard for plans loaded from storage — corrupt rows are dropped, never crash. */
export function isValidPlan(p: unknown): p is CoordinationPlan {
  if (typeof p !== "object" || p === null) return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.threadId === "string" &&
    typeof v.title === "string" &&
    typeof v.createdAt === "number" &&
    Array.isArray(v.steps) &&
    (v.status === "proposed" ||
      v.status === "approved" ||
      v.status === "rejected" ||
      v.status === "superseded" ||
      v.status === "consumed" ||
      v.status === "revoked")
  );
}

/** Persistence surface for plan records. AsyncStorage in production, fake in tests. */
export interface PlanGatePersistence {
  load(): Promise<CoordinationPlan[]>;
  save(plans: CoordinationPlan[]): Promise<void>;
}

export function createPlanGateStore(initialPersistence?: PlanGatePersistence) {
  const plans = new Map<string, CoordinationPlan>();
  const listeners = new Set<() => void>();
  let persistence: PlanGatePersistence | undefined = initialPersistence;
  // Save chain: mutations are synchronous, saves are async — serialize them
  // so a slow save can't land out of order and resurrect an older state.
  let saveChain: Promise<void> = Promise.resolve();
  let lastSaveFailed = false;

  function scheduleSave(): void {
    const p = persistence;
    if (!p) return;
    const snapshot = [...plans.values()];
    saveChain = saveChain
      .then(() => p.save(snapshot))
      .then(
        () => {
          lastSaveFailed = false;
        },
        () => {
          // Best-effort: a failed plan save must not break the chain or the
          // UI. The flag is readable via saveFailed() so future UI can surface it.
          lastSaveFailed = true;
        },
      );
  }
  // getSnapshot() MUST return a stable reference: useSyncExternalStore
  // force-rerenders whenever Object.is(getSnapshot(), prev) is false, so a
  // fresh object literal here spins an infinite render loop.
  let snapshot: { plans: CoordinationPlan[] } = { plans: [] };

  function emit() {
    snapshot = { plans: [...plans.values()] };
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
      return snapshot;
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
      scheduleSave();
      return plan;
    },

    /** Her decision on the card. Returns false when the plan is unknown. */
    decide(planId: string, approved: boolean): boolean {
      const p = plans.get(planId);
      if (p?.status !== "proposed") return false;
      plans.set(planId, { ...p, status: approved ? "approved" : "rejected" });
      emit();
      scheduleSave();
      return true;
    },

    /**
     * Consume an approved plan (P2-9): one approval authorizes ONE meeting.
     * start_group_meeting calls this after the meeting is created, so a
     * second meeting can't ride on the same approval. The spending meeting's
     * id is recorded so its own rounds keep passing the per-round re-check.
     * Returns false unless the plan was approved and unused.
     */
    consumePlan(planId: string, meetingId?: string): boolean {
      const p = plans.get(planId);
      if (p?.status !== "approved") return false;
      plans.set(planId, {
        ...p,
        status: "consumed",
        ...(meetingId ? { consumedByMeetingId: meetingId } : {}),
      });
      emit();
      scheduleSave();
      return true;
    },

    /**
     * She takes back an approval (P2-9). Only from "approved" — a consumed
     * plan already ran, and proposed/rejected ones have their own paths.
     * Returns false when the transition isn't allowed.
     */
    revokePlan(planId: string): boolean {
      const p = plans.get(planId);
      if (p?.status !== "approved") return false;
      plans.set(planId, { ...p, status: "revoked" });
      emit();
      scheduleSave();
      return true;
    },

    /**
     * Load persisted plans (call once at app start). Invalid rows are
     * dropped. Plans proposed while the load is in flight survive: the
     * loaded snapshot may predate their persistence, so anything that
     * appeared in memory during the await is re-applied on top (it is
     * the newer state). Only call before session activity, not
     * mid-conversation.
     */
    async hydrate(): Promise<void> {
      const p = persistence;
      if (!p) return;
      const before = new Set(plans.keys());
      const loaded = await p.load().catch(() => [] as CoordinationPlan[]);
      // Ids that appeared in memory while the load was in flight — they
      // are newer than the snapshot and must not be wiped by the replace.
      const inFlight = new Map<string, CoordinationPlan>();
      for (const [id, plan] of plans) {
        if (!before.has(id)) inFlight.set(id, plan);
      }
      plans.clear();
      for (const p of loaded) {
        if (isValidPlan(p)) plans.set(p.id, p);
      }
      for (const [id, plan] of inFlight) plans.set(id, plan);
      emit();
    },

    /** True when the most recent persistence write failed. */
    saveFailed(): boolean {
      return lastSaveFailed;
    },

    /**
     * Attach (or replace) persistence after creation. Used by the app
     * singleton (plan-gate-instance.ts) so tests keep the PURE module's
     * unpersisted singleton while UI and AI tools share the persisted one.
     */
    attachPersistence(p: PlanGatePersistence): void {
      persistence = p;
    },

    /** Test hook. */
    __resetForTests(): void {
      plans.clear();
      emit();
      scheduleSave();
    },
  };
}

export type PlanGateStore = ReturnType<typeof createPlanGateStore>;

/** App-wide singleton. */
export const planGateStore = createPlanGateStore();
