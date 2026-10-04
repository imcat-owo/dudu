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

/**
 * Keyed variant: one independent exclusive chain per storage key. Two
 * modules writing the SAME key must share one instance (see
 * sharedKeyedChain) so their read-modify-write cycles never interleave —
 * e.g. chat/cross-dialog.ts and api-groups/local-agent.ts both write
 * dudu.local-chat.<id>.v1 history keys. Keys are pruned once nothing is
 * queued behind them, so the map can't grow without bound.
 */
export type KeyedExclusiveRunner = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/** Create a keyed runner. The returned runner is one chain per key. */
export function createKeyedWriteChain(): KeyedExclusiveRunner {
  const chains = new Map<string, Promise<void>>();
  return function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const cur = prev.then(fn, fn);
    const tail = cur.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return cur;
  };
}

/**
 * The one shared keyed chain for the app. Import this (not a private
 * createKeyedWriteChain()) whenever the storage key can be written from
 * more than one module — sharing the instance is what makes same-key
 * writes actually serialize.
 */
export const sharedKeyedChain: KeyedExclusiveRunner = createKeyedWriteChain();
