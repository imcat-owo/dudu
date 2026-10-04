/**
 * AI avatar animation states.
 *
 * The six scenario names come from the owner's animated avatar set
 * (artwork/avatar-anim/): idle.mp4 covers idle+connecting, working.mp4
 * covers working+waiting_for_subagents, plus making_something.mp4 and
 * milestone_level_up.mp4.
 *
 * Today the app produces busy/running plus two finer signals — see
 * resolveAvatarState: a creative tool executing (making_something) and a
 * task card freshly reaching done (milestone_level_up, transient).
 */
export type AvatarState =
  | "idle"
  | "connecting"
  | "working"
  | "waiting_for_subagents"
  | "making_something"
  | "milestone_level_up";

/** The four bundled video files (artwork/avatar-anim/, byte-identical). */
export type AvatarVideoFile = "idle" | "working" | "making_something" | "milestone_level_up";

/**
 * Which bundled mp4 plays for each state. Two states share each of the
 * idle/working videos, matching the owner's 6-scenario set.
 */
export const AVATAR_STATE_VIDEO: Record<AvatarState, AvatarVideoFile> = {
  idle: "idle",
  connecting: "idle",
  working: "working",
  waiting_for_subagents: "working",
  making_something: "making_something",
  milestone_level_up: "milestone_level_up",
};

/** All states, for exhaustiveness checks. */
export const AVATAR_STATES: readonly AvatarState[] = [
  "idle",
  "connecting",
  "working",
  "waiting_for_subagents",
  "making_something",
  "milestone_level_up",
];

/** How long the level-up clip plays when a task card freshly reaches done. */
export const MILESTONE_CELEBRATION_MS = 8000;

/**
 * Map the app's real AI activity signals to an AvatarState.
 * `busy` = chat turn in flight; `running` = agent engine running
 * (both exist today in chat.tsx). `makingSomething` = a creative tool
 * (image/podcast generation) is executing right now — tracked by the
 * local agent's tool loop. `celebrateUntil` = ms timestamp of a recent
 * milestone (a task card reaching done); while now < celebrateUntil the
 * level-up clip plays, then the state falls back to the live signals.
 * `now` is injectable for tests. Priority: celebration > making > working.
 */
export function resolveAvatarState(opts: {
  busy: boolean;
  running: boolean;
  makingSomething?: boolean;
  celebrateUntil?: number;
  now?: number;
}): AvatarState {
  const now = opts.now ?? Date.now();
  if (opts.celebrateUntil !== undefined && now < opts.celebrateUntil) {
    return "milestone_level_up";
  }
  if (opts.makingSomething) return "making_something";
  return opts.busy || opts.running ? "working" : "idle";
}
