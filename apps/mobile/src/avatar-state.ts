/**
 * AI avatar animation states.
 *
 * The six scenario names come from the owner's animated avatar set
 * (artwork/avatar-anim/): idle.mp4 covers idle+connecting, working.mp4
 * covers working+waiting_for_subagents, plus making_something.mp4 and
 * milestone_level_up.mp4.
 *
 * Today the app can only produce coarse signals (busy / running) — see
 * resolveAvatarState. The richer states exist in the type so future work
 * (subagent events, the "our space" status area) can wire them without
 * changing the component contract. Don't invent states the app can't
 * produce; map what's real.
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

/**
 * Map the app's real AI activity signals to an AvatarState.
 * `busy` = chat turn in flight; `running` = agent engine running
 * (both exist today in chat.tsx). Everything else is "idle" until the
 * app learns finer-grained signals.
 */
export function resolveAvatarState(opts: { busy: boolean; running: boolean }): AvatarState {
  return opts.busy || opts.running ? "working" : "idle";
}
