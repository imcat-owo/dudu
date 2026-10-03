/**
 * Drop-zone ref registry — screens register the Views that count as
 * drop targets; the pet overlay measures them at drop time (so scrolling
 * never leaves stale rects) and hit-tests in priority order.
 */
import { useEffect, useRef } from "react";
import type { View } from "react-native";
import {
  DROP_ZONE_PRIORITY,
  type DropZone,
  type DropZoneId,
  pickDropZone,
  type ZoneRect,
} from "./dropzones";

type Ref = { current: { measureInWindow?: unknown } | null };

const registry = new Map<DropZoneId, Ref>();

export function registerDropZone(id: DropZoneId, ref: Ref): void {
  registry.set(id, ref);
}

export function unregisterDropZone(id: DropZoneId): void {
  registry.delete(id);
}

/** React hook: register a zone ref for the component's lifetime. Pass null for no zone. */
export function useDropZone(id: DropZoneId | null): React.RefObject<View | null> {
  const ref = useRef<View | null>(null);
  useEffect(() => {
    if (!id) return;
    registerDropZone(id, ref);
    return () => {
      unregisterDropZone(id);
    };
  }, [id]);
  return ref;
}

function measureRef(ref: Ref): Promise<ZoneRect | null> {
  return new Promise((resolve) => {
    try {
      const node = ref.current as unknown as {
        measureInWindow?: (
          cb: (x: number, y: number, width: number, height: number) => void,
        ) => void;
      } | null;
      if (!node || typeof node.measureInWindow !== "function") {
        resolve(null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!Number.isFinite(x) || width <= 0 || height <= 0) resolve(null);
        else resolve({ x, y, width, height });
      });
    } catch {
      resolve(null);
    }
  });
}

/** Measure every registered zone and pick the winner at (x, y). */
export async function hitTestAt(x: number, y: number): Promise<DropZoneId | null> {
  const entries = [...registry.entries()];
  const zones: DropZone[] = [];
  const rects = await Promise.all(entries.map(([, ref]) => measureRef(ref)));
  entries.forEach(([id], i) => {
    const rect = rects[i];
    if (rect) zones.push({ id, rect, priority: DROP_ZONE_PRIORITY[id] });
  });
  return pickDropZone(zones, x, y);
}

/** Measure one zone (for anchoring the pet to it). Null when unavailable. */
export async function measureZone(id: DropZoneId): Promise<ZoneRect | null> {
  const ref = registry.get(id);
  if (!ref) return null;
  return measureRef(ref);
}

/**
 * Message id of the currently registered last-AI-bubble. The pet only
 * stays perched while this matches the id it was dropped on; a new AI
 * message means its bubble scrolled away.
 */
let aiBubbleMessageId: string | null = null;

export function setAiBubbleMessageId(id: string | null): void {
  aiBubbleMessageId = id;
}

export function getAiBubbleMessageId(): string | null {
  return aiBubbleMessageId;
}
