/**
 * Drop-zone hit testing — pure geometry, no react-native imports.
 *
 * Zones (priority order):
 *   ai-bubble  — an AI chat bubble (pet sits on it)
 *   input-top  — the top edge of the chat input bar (pet sits on it)
 *   tab-space  — the "space" tab button (throw the pet into 我们的空间）
 *   tab-chat   — the "chat" tab button (bring the pet back to chat)
 *   dialog     — anywhere in the chat message area (pet wanders free)
 */

export type DropZoneId = "ai-bubble" | "input-top" | "dialog" | "tab-space" | "tab-chat";

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropZone {
  id: DropZoneId;
  rect: ZoneRect;
  /** higher wins when zones overlap */
  priority: number;
}

export const DROP_ZONE_PRIORITY: Record<DropZoneId, number> = {
  "ai-bubble": 40,
  "input-top": 30,
  "tab-space": 20,
  "tab-chat": 20,
  dialog: 10,
};

export function pointInRect(rect: ZoneRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Pick the highest-priority zone containing the point, or null. */
export function pickDropZone(zones: DropZone[], x: number, y: number): DropZoneId | null {
  let best: DropZone | null = null;
  for (const z of zones) {
    if (!pointInRect(z.rect, x, y)) continue;
    if (!best || z.priority > best.priority) best = z;
  }
  return best ? best.id : null;
}
