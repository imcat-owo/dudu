/**
 * Image compression settings — PURE module (no React Native imports).
 *
 * D6: Before sending her photos to the model, compress to a chosen tier.
 * Saves data and speeds things up — she sends a lot of pictures.
 *
 * Tiers: "original" | "high" | "medium" | "low".
 * The actual resize uses expo-image-manipulator (lazy, native module);
 * this module holds the settings + tier definitions.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "dudu.image-compression.v1";

export type CompressionTier = "original" | "high" | "medium" | "low";

export interface CompressionSpec {
  /** Max dimension (px) on the long edge. null = keep original. */
  maxEdge: number | null;
  /** JPEG quality 0-1. */
  quality: number;
}

export const COMPRESSION_SPECS: Record<CompressionTier, CompressionSpec> = {
  original: { maxEdge: null, quality: 1 },
  high: { maxEdge: 2048, quality: 0.85 },
  medium: { maxEdge: 1280, quality: 0.7 },
  low: { maxEdge: 800, quality: 0.5 },
};

export const COMPRESSION_TIERS: CompressionTier[] = ["original", "high", "medium", "low"];

async function loadManipulator(): Promise<{
  manipulateAsync: (
    uri: string,
    actions: Array<{ resize?: { width?: number; height?: number } }>,
    opts: { compress: number; format: "jpeg" | "png" },
  ) => Promise<{ uri: string }>;
} | null> {
  try {
    // Optional dependency — not in package.json; falls back honestly if missing.
    const mod = (await import(
      /* webpackIgnore: true */ "expo-image-manipulator"
    )) as unknown as {
      manipulateAsync: (
        uri: string,
        actions: Array<{ resize?: { width?: number; height?: number } }>,
        opts: { compress: number; format: "jpeg" | "png" },
      ) => Promise<{ uri: string }>;
    };
    return mod;
  } catch {
    return null;
  }
}

/**
 * Compress an image URI per the tier. Returns the (possibly new) URI.
 * If the native module is missing, returns the original honestly.
 */
export async function compressImage(
  uri: string,
  tier: CompressionTier,
): Promise<{ uri: string; compressed: boolean }> {
  const spec = COMPRESSION_SPECS[tier];
  if (tier === "original" || !spec.maxEdge) return { uri, compressed: false };
  const manip = await loadManipulator();
  if (!manip) return { uri, compressed: false };
  try {
    const result = await manip.manipulateAsync(
      uri,
      [{ resize: { width: spec.maxEdge } }],
      { compress: spec.quality, format: "jpeg" },
    );
    return { uri: result.uri, compressed: true };
  } catch {
    return { uri, compressed: false };
  }
}

export function createCompressionStore() {
  let tier: CompressionTier | null = null;
  const listeners = new Set<() => void>();
  let snapshot: { tier: CompressionTier; loaded: boolean } = {
    tier: "high",
    loaded: false,
  };

  function emit() {
    snapshot = { tier: tier ?? "high", loaded: tier !== null };
    for (const l of listeners) l();
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(KEY);
          if (raw && (COMPRESSION_TIERS as string[]).includes(raw)) {
            tier = raw as CompressionTier;
          }
        } catch {
          // ignore
        }
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    async setTier(t: CompressionTier): Promise<void> {
      tier = t;
      try {
        await AsyncStorage.setItem(KEY, t);
      } catch {
        // ignore
      }
      emit();
    },
    async getTier(): Promise<CompressionTier> {
      await ensureLoaded();
      return tier ?? "high";
    },
  };
}

export const compressionStore = createCompressionStore();

export function useCompressionTier(): { tier: CompressionTier; loaded: boolean } {
  const snap = useSyncExternalStore(
    compressionStore.subscribe,
    compressionStore.getSnapshot,
    compressionStore.getSnapshot,
  );
  return snap;
}
