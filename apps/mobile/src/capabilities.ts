/**
 * Capability registry — the single source of truth for out-of-app capabilities.
 *
 * Her AI permission model (non-negotiable, 2026-10-03):
 * - Inside the app, the AI is a full管家: one-sentence errands, full authority.
 * - Anything OUTSIDE the app (photo library, location, bluetooth, clipboard,
 *   notifications, sending outward, …) MUST get her authorization first —
 *   a popup each time, or per her saved preference. She can revoke anytime.
 *
 * This file is PURE (no React Native / expo imports) so it stays unit-testable
 * in plain node. System permission wiring lives in device-permissions.ts;
 * the UI joins them by CapabilityId. Icons live in the UI layer.
 *
 * The aiDescriptionKey texts are written in plain human language for the AI.
 * buildCapabilityPromptSection() renders them into a system-prompt block
 * (consumed by the MCP phase later).
 */

import type { StringKey } from "./i18n";

export type CapabilityId =
  | "bluetooth"
  | "photos"
  | "location"
  | "clipboard"
  | "notifications"
  | "sandbox";

/** Every capability in this registry crosses the app boundary. */
export type CapabilityScope = "out-of-app";

export interface CapabilityDef {
  id: CapabilityId;
  scope: CapabilityScope;
  /** i18n key: short display name, e.g. perm.kind.photos */
  nameKey: StringKey;
  /** i18n key: plain-human-language description of what this lets the AI do,
   *  written FOR the AI (feeds its system prompt). Always ends with the
   *  must-ask-her rule. */
  aiDescriptionKey: StringKey;
  /** i18n key: why the app wants it — shown BEFORE the iOS system dialog
   *  (Apple HIG: explain value before asking). */
  whyKey: StringKey;
}

export const CAPABILITIES: Record<CapabilityId, CapabilityDef> = {
  bluetooth: {
    id: "bluetooth",
    scope: "out-of-app",
    nameKey: "perm.kind.bluetooth",
    aiDescriptionKey: "perm.aiDesc.bluetooth",
    whyKey: "perm.why.bluetooth",
  },
  photos: {
    id: "photos",
    scope: "out-of-app",
    nameKey: "perm.kind.photos",
    aiDescriptionKey: "perm.aiDesc.photos",
    whyKey: "perm.why.photos",
  },
  location: {
    id: "location",
    scope: "out-of-app",
    nameKey: "perm.kind.location",
    aiDescriptionKey: "perm.aiDesc.location",
    whyKey: "perm.why.location",
  },
  clipboard: {
    id: "clipboard",
    scope: "out-of-app",
    nameKey: "perm.kind.clipboard",
    aiDescriptionKey: "perm.aiDesc.clipboard",
    whyKey: "perm.why.clipboard",
  },
  notifications: {
    id: "notifications",
    scope: "out-of-app",
    nameKey: "perm.kind.notifications",
    aiDescriptionKey: "perm.aiDesc.notifications",
    whyKey: "perm.why.notifications",
  },
  sandbox: {
    id: "sandbox",
    scope: "out-of-app",
    nameKey: "perm.kind.sandbox",
    aiDescriptionKey: "perm.aiDesc.sandbox",
    whyKey: "perm.why.sandbox",
  },
};

/** Device permissions with iOS system prompts (sandbox is AI-only, not a device permission). */
export type DeviceCapabilityId = Exclude<CapabilityId, "sandbox">;

/** Device permissions shown in the iOS settings UI (sandbox has its own UI). */
export const CAPABILITY_ORDER: DeviceCapabilityId[] = [
  "bluetooth",
  "photos",
  "location",
  "clipboard",
  "notifications",
];

/** All capabilities the AI knows about (device + sandbox). */
export const AI_CAPABILITY_ORDER: CapabilityId[] = [...CAPABILITY_ORDER, "sandbox"];

export function isCapabilityId(raw: string | null | undefined): raw is CapabilityId {
  return (
    raw === "bluetooth" ||
    raw === "photos" ||
    raw === "location" ||
    raw === "clipboard" ||
    raw === "notifications" ||
    raw === "sandbox"
  );
}

/**
 * Renders the capability section of the AI's system prompt.
 * resolve: (key) => localized string — pass t() on device, or a test stub.
 * The MCP phase will splice this into the agent's system instructions so the
 * AI knows exactly which capabilities exist and that it must ask her first.
 */
export function buildCapabilityPromptSection(resolve: (key: StringKey) => string): string {
  const lines = AI_CAPABILITY_ORDER.map((id) => {
    const def = CAPABILITIES[id];
    return `- ${resolve(def.nameKey)}: ${resolve(def.aiDescriptionKey)}`;
  });
  return lines.join("\n");
}
