/**
 * Coding task store — task lifecycle + audit log persistence.
 *
 * PURE module: persistence is injected (AsyncStorage in production via
 * instances.ts, fake in tests). Same save-chain pattern as plan-gate.
 */

import {
  type CodingLogEntry,
  type CodingProposeInput,
  type CodingTask,
  type CodingTaskStatus,
  type CodingVerifyResult,
  isValidCodingTask,
  MAX_VERIFY_ATTEMPTS,
  validateCodingInput,
} from "./types";

export interface CodingPersistence {
  load(): Promise<CodingTask[]>;
  save(tasks: CodingTask[]): Promise<void>;
}

export interface CodingStoreDeps {
  now?: () => number;
  newId?: () => string;
}

const DEFAULT_ID = () => `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createCodingStore(initialPersistence?: CodingPersistence, deps?: CodingStoreDeps) {
  const tasks = new Map<string, CodingTask>();
  const listeners = new Set<() => void>();
  let persistence: CodingPersistence | undefined = initialPersistence;
  let saveChain: Promise<void> = Promise.resolve();
  const now = deps?.now ?? Date.now;
  const newId = deps?.newId ?? DEFAULT_ID;

  function scheduleSave(): void {
    const p = persistence;
    if (!p) return;
    const snap = [...tasks.values()];
    saveChain = saveChain
      .then(() => p.save(snap))
      .catch(() => {
        /* best effort — the in-memory state stays authoritative */
      });
  }

  function emit(): void {
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* listener errors must not break the store */
      }
    }
  }

  function mutate(id: string, fn: (t: CodingTask) => void): CodingTask | null {
    const t = tasks.get(id);
    if (!t) return null;
    fn(t);
    t.updatedAt = now();
    scheduleSave();
    emit();
    return t;
  }

  function log(t: CodingTask, kind: CodingLogEntry["kind"], text: string): void {
    t.log.push({ at: now(), kind, text: text.slice(0, 4000) });
    if (t.log.length > 300) t.log.splice(0, t.log.length - 300);
  }

  return {
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot(): { tasks: CodingTask[] } {
      return { tasks: [...tasks.values()] };
    },

    /** Load persisted tasks (drops corrupt rows). Call once at startup. */
    async hydrate(): Promise<void> {
      if (!persistence) return;
      try {
        const rows = await persistence.load();
        for (const r of rows) {
          if (isValidCodingTask(r)) tasks.set(r.id, r);
        }
        emit();
      } catch {
        /* corrupt storage never bricks the feature */
      }
    },

    setPersistence(p: CodingPersistence): void {
      persistence = p;
    },

    getTask(id: string): CodingTask | null {
      return tasks.get(id) ?? null;
    },

    /** Latest non-terminal task for a thread (what the card shows). */
    activeForThread(threadId: string): CodingTask | null {
      const list = [...tasks.values()]
        .filter(
          (t) =>
            t.threadId === threadId &&
            (t.status === "proposed" || t.status === "approved" || t.status === "in_progress"),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      return list[0] ?? null;
    },

    /** Propose a task: validates, stores as "proposed". Her card appears. */
    propose(threadId: string, input: CodingProposeInput): CodingTask {
      const problem = validateCodingInput(input);
      if (problem) throw new Error(`invalid-coding-input:${problem}`);
      const id = newId();
      const at = now();
      const steps = (
        input.steps as Array<{ title: string; detail?: string; files?: string[] }>
      ).map((s, i) => ({
        id: `s${i + 1}`,
        title: s.title.trim(),
        detail: typeof s.detail === "string" ? s.detail.trim() || undefined : undefined,
        files: Array.isArray(s.files) ? s.files.map((f) => f.trim()).filter(Boolean) : [],
      }));
      const task: CodingTask = {
        id,
        threadId,
        title: (input.title as string).trim(),
        request: (input.request as string).trim(),
        steps,
        expectedOutcome: (input.expectedOutcome as string).trim(),
        doneCriteria: (input.doneCriteria as string).trim(),
        status: "proposed",
        attempts: 0,
        log: [],
        branch: `coding/${id.replace(/^ct_/, "").slice(0, 12)}`,
        touchedFiles: [],
        createdAt: at,
        updatedAt: at,
      };
      log(task, "plan", `计划已提出: ${task.title} (${steps.length} 步)`);
      tasks.set(id, task);
      scheduleSave();
      emit();
      return task;
    },

    /** Her decision on the card. Only "proposed" can be decided. */
    decide(id: string, approve: boolean): CodingTask | null {
      return mutate(id, (t) => {
        if (t.status !== "proposed") return;
        t.status = approve ? "approved" : "rejected";
        log(t, "plan", approve ? "她批准了计划，可以开工。" : "她叫停了计划，不执行。");
      });
    },

    setStatus(id: string, status: CodingTaskStatus): CodingTask | null {
      return mutate(id, (t) => {
        t.status = status;
      });
    },

    appendLog(id: string, kind: CodingLogEntry["kind"], text: string): void {
      const t = tasks.get(id);
      if (!t) return;
      log(t, kind, text);
      t.updatedAt = now();
      scheduleSave();
      emit();
    },

    touchFile(id: string, path: string): void {
      const t = tasks.get(id);
      if (!t || t.touchedFiles.includes(path)) return;
      t.touchedFiles.push(path);
      t.updatedAt = now();
      scheduleSave();
    },

    /** Record a verify round. Returns false when the attempt budget is spent. */
    recordVerify(id: string, result: CodingVerifyResult): boolean {
      const t = tasks.get(id);
      if (!t) return false;
      if (t.attempts >= MAX_VERIFY_ATTEMPTS) return false;
      t.attempts += 1;
      result.attempt = t.attempts;
      t.verify = result;
      log(
        t,
        "verify",
        `第 ${t.attempts} 轮验证: ${result.ok ? "通过" : "未通过"} — ${result.summary}`,
      );
      t.updatedAt = now();
      scheduleSave();
      emit();
      return true;
    },

    complete(id: string, outcome: "done" | "failed", report: string): CodingTask | null {
      return mutate(id, (t) => {
        t.status = outcome;
        t.report = report.slice(0, 8000);
        log(t, "report", outcome === "done" ? `完成: ${report}` : `未完成，如实汇报: ${report}`);
      });
    },
  };
}

export type CodingStore = ReturnType<typeof createCodingStore>;
export { MAX_VERIFY_ATTEMPTS };
