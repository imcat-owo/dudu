/**
 * Shared write-chain helper — the single canonical implementation of the
 * read-modify-write serialization pattern used across every store that
 * persists JSON to AsyncStorage/SecureStore.
 *
 * Several stores hand-rolled copies of this exact pattern (drift risk);
 * they now all delegate to this module.
 */

/**
 * An exclusive runner: `exclusive(fn)` runs `fn` after every previously
 * queued mutation finishes, so concurrent read→modify→write cycles on the
 * same key can never interleave and lose one writer's update. Reads stay
 * unlocked — they never lose data.
 *
 * The chain never breaks: each link swallows its own rejection for chaining
 * purposes, while the caller still sees fn's real result/rejection.
 */
export type ExclusiveRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/** Create one independent exclusive runner. */
export function createWriteChain(): ExclusiveRunner {
  let tail: Promise<void> = Promise.resolve();
  return function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const cur = tail.then(fn, fn);
    tail = cur.then(
      () => undefined,
      () => undefined,
    );
    return cur;
  };
}
