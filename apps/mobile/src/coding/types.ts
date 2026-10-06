/**
 * Coding-agent loop (E3): plan → execute → verify → report.
 *
 * The loop works on a git checkout of the app repo INSIDE the sandbox
 * backend (her cloud Docker container or the local iSH guest) — it reuses
 * the existing SandboxBackend.runCommand, it does not fork a parallel
 * file-editing system. The plan-approval card is the product-level consent
 * gate (her rule: 删改先经她同意); the engine enforces it — no writes,
 * no commands, no verification run before she approves.
 *
 * PURE module: no React Native / expo imports. Unit-testable in node.
 */

/** Lifecycle of a coding task. */
export type CodingTaskStatus =
  | "proposed" // plan shown, waiting for her decision
  | "approved" // she approved; work may start
  | "rejected" // she stopped it; terminal
  | "in_progress" // executing / verifying
  | "done" // complete() with a green verification
  | "failed"; // complete() with an honest failure report

/** One step of the approved plan. */
export interface CodingPlanStep {
  /** Stable id, assigned at propose time. */
  id: string;
  title: string;
  detail?: string;
  /** Repo-relative file paths this step touches (e.g. "apps/mobile/src/foo.ts"). */
  files: string[];
}

/** A line in the task's audit log. Every write/run/verify lands here. */
export interface CodingLogEntry {
  at: number;
  kind: "plan" | "write" | "run" | "verify" | "fix" | "report" | "error";
  text: string;
}

/** Result of one verification check (tsc / biome / tests). */
export interface CodingCheckResult {
  ok: boolean;
  /** Set when the check did not run. Human-readable reason. */
  skipped?: string;
  /**
   * True when the skip is caused by missing prerequisites (no node,
   * no node_modules) — the check did NOT verify anything, so the round
   * as a whole fails. False/undefined skips are "nothing to check"
   * (no touched files / no test files) and don't fail the round.
   */
  blocked?: boolean;
  /** Trimmed command output (stdout + stderr), for the fix round. */
  output: string;
}

/** Structured result of one verify round. Never faked — produced by real commands. */
export interface CodingVerifyResult {
  ok: boolean;
  tsc: CodingCheckResult;
  biome: CodingCheckResult;
  tests: CodingCheckResult;
  /** Which attempt this was (1-based). */
  attempt: number;
  summary: string;
}

export interface CodingTask {
  id: string;
  threadId: string;
  title: string;
  /** Her original request, in her words. */
  request: string;
  steps: CodingPlanStep[];
  expectedOutcome: string;
  doneCriteria: string;
  status: CodingTaskStatus;
  /** Verify attempts used (bounded by MAX_VERIFY_ATTEMPTS). */
  attempts: number;
  log: CodingLogEntry[];
  /** Latest verification result, if verify ran. */
  verify?: CodingVerifyResult;
  /** Final report text (set by complete). */
  report?: string;
  /** Working branch in the sandbox checkout, e.g. "coding/a1b2c3". */
  branch: string;
  /** Repo-relative paths written during this task (for the final commit). */
  touchedFiles: string[];
  createdAt: number;
  updatedAt: number;
}

/** Bounded retries: verify → fix → re-verify at most this many rounds. */
export const MAX_VERIFY_ATTEMPTS = 3;

/** Input the model provides when proposing a task. */
export interface CodingProposeInput {
  title?: unknown;
  request?: unknown;
  steps?: unknown;
  expectedOutcome?: unknown;
  doneCriteria?: unknown;
}

/** Validation shared by the tool and tests. Returns an error key or null. */
export function validateCodingInput(input: CodingProposeInput): string | null {
  if (typeof input.title !== "string" || !input.title.trim()) return "titleRequired";
  if (typeof input.request !== "string" || !input.request.trim()) return "requestRequired";
  if (typeof input.expectedOutcome !== "string" || !input.expectedOutcome.trim())
    return "outcomeRequired";
  if (typeof input.doneCriteria !== "string" || !input.doneCriteria.trim())
    return "criteriaRequired";
  if (!Array.isArray(input.steps) || input.steps.length === 0) return "stepsRequired";
  if (input.steps.length > 20) return "stepsTooMany";
  for (const s of input.steps) {
    if (typeof s !== "object" || s === null) return "stepsInvalid";
    const t = (s as { title?: unknown }).title;
    if (typeof t !== "string" || !t.trim()) return "stepsInvalid";
    const files = (s as { files?: unknown }).files;
    if (files !== undefined) {
      if (!Array.isArray(files) || files.some((f) => typeof f !== "string" || !f.trim()))
        return "stepsInvalid";
    }
  }
  return null;
}

/** Shape guard for tasks loaded from storage — corrupt rows are dropped, never crash. */
export function isValidCodingTask(t: unknown): t is CodingTask {
  if (typeof t !== "object" || t === null) return false;
  const v = t as Record<string, unknown>;
  const statuses: CodingTaskStatus[] = [
    "proposed",
    "approved",
    "rejected",
    "in_progress",
    "done",
    "failed",
  ];
  return (
    typeof v.id === "string" &&
    typeof v.threadId === "string" &&
    typeof v.title === "string" &&
    Array.isArray(v.steps) &&
    statuses.includes(v.status as CodingTaskStatus) &&
    typeof v.attempts === "number" &&
    Array.isArray(v.log) &&
    typeof v.branch === "string" &&
    Array.isArray(v.touchedFiles)
  );
}
