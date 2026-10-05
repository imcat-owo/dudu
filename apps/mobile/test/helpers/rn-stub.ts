/**
 * Shared React Native / Expo stub for node:test runs under plain tsx.
 *
 * WHY THIS EXISTS: several pure-logic modules (notably
 * `src/api-groups/local-agent.ts`) have a transitive import graph that
 * reaches `react-native` (Flow syntax — esbuild cannot transform it) and
 * various `expo-*` packages (which read the RN-only `__DEV__` global at
 * import time). Under a real device/bundler those load fine; under plain
 * node they crash the whole test FILE before a single test runs.
 *
 * WHAT IT DOES (side effect on import — keep this the FIRST import in the
 * test file so the patch is installed before any tainted module loads):
 * - defines the `__DEV__` global some expo packages read at import time
 * - patches `Module._load` to return inert stubs for `react-native`,
 *   `lucide-react-native`, `@react-native-async-storage/async-storage`
 *   and every `expo*` package
 * - `expo-localization` is special-cased to report no locales so i18n
 *   falls back to English (matching the documented fallback in
 *   `src/i18n/index.ts`)
 *
 * The stubs are deliberately dumb: property access / calls / `new` all
 * return another inert stub. Tests that need REAL rendering or REAL
 * native behavior do not belong under plain tsx — this helper is only
 * for pinning pure logic (prompt builders, tool contracts, stores).
 *
 * Each test file runs in its own process (`--test-isolation=process`),
 * so the global patch cannot leak into other files.
 */
import Module from "node:module";

// Some expo packages read __DEV__ at import time. Define it so that even
// a directly-required expo package degrades instead of throwing
// ReferenceError.
(globalThis as Record<string, unknown>).__DEV__ = false;

/** An inert stub: any property get / call / construct returns another stub. */
// biome-ignore lint/suspicious/noExplicitAny: universal stub is any by design.
function makeProxyStub(): any {
  const target = (..._args: unknown[]): unknown => {
    return proxy;
  };
  // biome-ignore lint/suspicious/noExplicitAny: universal stub is any by design.
  const proxy: any = new Proxy(target, {
    get(_t, p) {
      if (p === "__esModule") return true;
      if (p === "default") return proxy;
      // Never look like a thenable — `await stub` must resolve, not hang.
      if (p === "then") return undefined;
      if (p === Symbol.toPrimitive) {
        return (hint: string) => (hint === "number" ? 0 : "");
      }
      return proxy;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy as object;
    },
  });
  return proxy;
}

/** In-memory AsyncStorage stand-in (the real one needs native code). */
function makeMemoryStorage(): unknown {
  const data = new Map<string, string>();
  const api = {
    getItem: async (k: string): Promise<string | null> =>
      data.has(k) ? (data.get(k) as string) : null,
    setItem: async (k: string, v: string): Promise<void> => {
      data.set(k, String(v));
    },
    removeItem: async (k: string): Promise<void> => {
      data.delete(k);
    },
    clear: async (): Promise<void> => {
      data.clear();
    },
    getAllKeys: async (): Promise<string[]> => [...data.keys()],
    multiGet: async (ks: string[]): Promise<[string, string | null][]> =>
      ks.map((k) => [k, data.has(k) ? (data.get(k) as string) : null]),
    multiSet: async (kv: [string, string][]): Promise<void> => {
      for (const [k, v] of kv) data.set(k, String(v));
    },
    multiRemove: async (ks: string[]): Promise<void> => {
      for (const k of ks) data.delete(k);
    },
  };
  return { default: api, ...api };
}

const rnStub = makeProxyStub();
const lucideStub = makeProxyStub();
const expoStub = makeProxyStub();
const storageStub = makeMemoryStorage();
// expo-localization: report no locales → i18n falls back to English,
// exactly like the catch path in src/i18n/index.ts detectLocale().
const localizationStub = { getLocales: () => [] as unknown[] };

const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (
  request: unknown,
  ...rest: unknown[]
) {
  if (request === "react-native") return rnStub;
  if (request === "lucide-react-native") return lucideStub;
  if (request === "@react-native-async-storage/async-storage") return storageStub;
  if (request === "expo-localization") return localizationStub;
  if (typeof request === "string" && (request === "expo" || request.startsWith("expo-"))) {
    return expoStub;
  }
  return originalLoad.call(this, request, ...rest);
};
