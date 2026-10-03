/**
 * ThemeProvider — runtime theming for OpenMuse mobile (theme-design.md §§2,6).
 *
 * - bundle: the effective bundle (a staged try-on wins over confirmed)
 * - resolvedMode: "light" | "dark", from bundle.mode + useColorScheme()
 * - tokens: the 8 surfaces derived for resolvedMode via HCT tonal palettes
 * - stageBundle: try-on — applies in memory only, never persisted (§6.1)
 * - applyBundle: confirm — persists to AsyncStorage AND PUTs /api/theme (§6.2)
 * - rollback: restore the last confirmed bundle (§6.3)
 * - serverVersion: polled from /api/theme; refreshes when it changes
 * - Corrupt stored bundle -> default preset rebuilt, never a blank screen (§6.4)
 *
 * The /api/theme endpoint is optional: when unreachable (or when no apiToken
 * is provided) the provider silently stays on the local cache.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { API_URL } from "../api";
import { deriveSurfaces, type ResolvedMode, resolveMode } from "./derive";
import { defaultPreset } from "./presets";
import { isThemeBundle, type SurfaceId, type SurfaceTokens, type ThemeBundle } from "./types";

export const THEME_STORAGE_KEY = "openmuse.theme.bundle.v1";
const SERVER_POLL_MS = 30_000;

export type ThemeContextValue = {
  /** Effective bundle: staged try-on wins over the confirmed bundle. */
  bundle: ThemeBundle;
  /** Last confirmed (persisted) bundle. */
  confirmedBundle: ThemeBundle;
  /** True while a try-on is staged. */
  staging: boolean;
  resolvedMode: ResolvedMode;
  /** The 8 surface token sets for resolvedMode. */
  tokens: Record<SurfaceId, SurfaceTokens>;
  /** Last known /api/theme version, null when the server was never reached. */
  serverVersion: number | null;
  /** Try-on: applies in memory only, never persisted. False if invalid. */
  stageBundle: (bundle: ThemeBundle) => boolean;
  /** Abandon the staged try-on. */
  cancelStage: () => void;
  /** Confirm: persist locally AND PUT to /api/theme. False if invalid. */
  applyBundle: (bundle: ThemeBundle) => Promise<boolean>;
  /** Restore the bundle that was confirmed before the last apply. */
  rollback: () => Promise<void>;
  /** Re-check /api/theme now and adopt the bundle if its version changed. */
  refreshFromServer: () => Promise<void>;
};

function buildFallbackValue(bundle: ThemeBundle): ThemeContextValue {
  const resolvedMode = resolveMode(bundle.mode, false);
  return {
    bundle,
    confirmedBundle: bundle,
    staging: false,
    resolvedMode,
    tokens: deriveSurfaces(bundle.seed, resolvedMode),
    serverVersion: null,
    stageBundle: () => false,
    cancelStage: () => {},
    applyBundle: async () => false,
    rollback: async () => {},
    refreshFromServer: async () => {},
  };
}

const ThemeContext = createContext<ThemeContextValue>(buildFallbackValue(defaultPreset));

/** Any screen wrapped in ThemeProvider gets live tokens from this hook. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

type RemoteTheme = { version: number; bundle: ThemeBundle };

async function persistLocal(bundle: ThemeBundle): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    // Storage failure must never break theming; in-memory state still applies.
  }
}

export function ThemeProvider({
  children,
  apiToken,
}: {
  children: ReactNode;
  apiToken?: string;
}): ReactNode {
  const systemScheme = useColorScheme();
  const [confirmed, setConfirmed] = useState<ThemeBundle>(defaultPreset);
  const [staged, setStaged] = useState<ThemeBundle | null>(null);
  const [serverVersion, setServerVersion] = useState<number | null>(null);

  const confirmedRef = useRef(confirmed);
  const previousRef = useRef<ThemeBundle | null>(null);
  const serverVersionRef = useRef<number | null>(null);
  const stagedRef = useRef<ThemeBundle | null>(null);

  useEffect(() => {
    confirmedRef.current = confirmed;
  }, [confirmed]);

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // ---- local cache: load on mount, self-heal on corruption ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: ThemeBundle = defaultPreset;
      try {
        const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (raw !== null) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          if (isThemeBundle(parsed)) {
            next = parsed;
          } else {
            // Corrupt cache: rebuild the default bundle (self-heal, never blank).
            await persistLocal(defaultPreset);
          }
        }
      } catch {
        next = defaultPreset;
      }
      if (!cancelled) setConfirmed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- server sync: /api/theme is optional, local cache is the fallback ----
  const fetchRemote = useCallback(async (): Promise<RemoteTheme | null> => {
    if (!apiToken) return null;
    try {
      const res = await fetch(`${API_URL}/api/theme`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { version?: unknown; bundle?: unknown };
      if (typeof payload.version !== "number" || !isThemeBundle(payload.bundle)) return null;
      return { version: payload.version, bundle: payload.bundle };
    } catch {
      return null;
    }
  }, [apiToken]);

  const refreshFromServer = useCallback(async (): Promise<void> => {
    const remote = await fetchRemote();
    if (!remote) return;
    if (serverVersionRef.current === remote.version) return;
    // Never clobber an active try-on: the user is mid-preview and the
    // banner offers Apply/Discard. Skip this poll; the next one retries
    // after staging ends (review P2-2, 2026-10-03).
    if (stagedRef.current) return;
    serverVersionRef.current = remote.version;
    setServerVersion(remote.version);
    setConfirmed(remote.bundle);
    await persistLocal(remote.bundle);
  }, [fetchRemote]);

  useEffect(() => {
    void refreshFromServer();
    const timer = setInterval(() => {
      void refreshFromServer();
    }, SERVER_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshFromServer]);

  // ---- try-on / confirm / rollback (safety net §6) ----
  const stageBundle = useCallback((bundle: ThemeBundle): boolean => {
    if (!isThemeBundle(bundle)) return false;
    setStaged(bundle); // in memory only — never persisted
    return true;
  }, []);

  const cancelStage = useCallback((): void => {
    setStaged(null);
  }, []);

  const applyBundle = useCallback(
    async (bundle: ThemeBundle): Promise<boolean> => {
      if (!isThemeBundle(bundle)) return false;
      const stamped: ThemeBundle = {
        ...bundle,
        meta: { ...bundle.meta, updatedAt: new Date().toISOString() },
      };
      previousRef.current = confirmedRef.current;
      setConfirmed(stamped);
      setStaged(null);
      await persistLocal(stamped);
      if (apiToken) {
        try {
          await fetch(`${API_URL}/api/theme`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ bundle: stamped }),
          });
        } catch {
          // Server unreachable: the local cache stays the source of truth.
        }
      }
      return true;
    },
    [apiToken],
  );

  const rollback = useCallback(async (): Promise<void> => {
    const target = previousRef.current ?? defaultPreset;
    const stamped: ThemeBundle = {
      ...target,
      meta: { ...target.meta, updatedAt: new Date().toISOString() },
    };
    setStaged(null);
    setConfirmed(stamped);
    await persistLocal(stamped);
    if (apiToken) {
      // Push the rollback to the server too, and adopt the new server
      // version — otherwise the 30s poll would fetch the pre-rollback
      // bundle and silently undo the rollback (review P2-1, 2026-10-03).
      try {
        const res = await fetch(`${API_URL}/api/theme`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ bundle: stamped }),
        });
        if (res.ok) {
          const payload = (await res.json()) as { version?: unknown };
          if (typeof payload.version === "number") {
            serverVersionRef.current = payload.version;
            setServerVersion(payload.version);
          }
        }
      } catch {
        // Server unreachable: the local cache stays the source of truth.
      }
    }
  }, [apiToken]);

  const effective = staged ?? confirmed;
  const resolvedMode = resolveMode(effective.mode, systemScheme === "dark");
  const tokens = useMemo(
    () => deriveSurfaces(effective.seed, resolvedMode),
    [effective.seed, resolvedMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      bundle: effective,
      confirmedBundle: confirmed,
      staging: staged !== null,
      resolvedMode,
      tokens,
      serverVersion,
      stageBundle,
      cancelStage,
      applyBundle,
      rollback,
      refreshFromServer,
    }),
    [
      effective,
      confirmed,
      staged,
      resolvedMode,
      tokens,
      serverVersion,
      stageBundle,
      cancelStage,
      applyBundle,
      rollback,
      refreshFromServer,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
