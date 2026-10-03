/**
 * AI authorization — the second layer of her permission model.
 *
 * Layer 1 (iOS system permission): does the OS allow the app to touch the
 *   hardware/data? Handled by device-permissions.ts.
 * Layer 2 (THIS FILE): does SHE allow the AI to use it right now?
 *
 * Even when the system permission is granted, the AI must pass this gate
 * before any out-of-app action. Her choice:
 *   - "ask"    (default): popup every time — Allow once / Always allow / Deny
 *   - "always": remembered, no popup, always proceed
 *   - "never":  remembered, no popup, always refuse
 * She can change any of these in Settings → Device permissions (revocable).
 *
 * Pure logic lives in ai-auth-core.ts (unit-tested); this file wires the
 * AsyncStorage singleton and the native popup.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { type AiAuthPreference, createAiAuthStore, decideFromPreference } from "./ai-auth-core";
import { CAPABILITIES, type CapabilityId, isCapabilityId } from "./capabilities";
import { t } from "./i18n";

export { AI_AUTH_PREFERENCES, decideFromPreference, isAiAuthPreference } from "./ai-auth-core";
export type { AiAuthPreference };

// Default singleton backed by AsyncStorage.
const defaultStore = createAiAuthStore(AsyncStorage);

export const getAiAuthPreferences = defaultStore.getSnapshot;
export const setAiAuthPreference = defaultStore.setPreference;
export const useAiAuthPreferences = defaultStore.usePreferences;
export const useAiAuthPreference = defaultStore.usePreference;

function showAuthPopup(args: {
  capability: CapabilityId;
  action: string;
  reason: string;
}): Promise<"once" | "always" | "deny"> {
  const name = t(CAPABILITIES[args.capability].nameKey);
  return new Promise((resolve) => {
    Alert.alert(
      t("perm.aiAuth.title", { capability: name }),
      `${args.action}\n\n${args.reason}`,
      [
        { text: t("perm.aiAuth.deny"), style: "cancel", onPress: () => resolve("deny") },
        { text: t("perm.aiAuth.alwaysAllow"), onPress: () => resolve("always") },
        { text: t("perm.aiAuth.allowOnce"), onPress: () => resolve("once") },
      ],
      { cancelable: true, onDismiss: () => resolve("deny") },
    );
  });
}

export interface AiAuthRequest {
  capability: CapabilityId;
  /** What the AI wants to do, in her language. e.g. "读取你相册里最新的 3 张照片" */
  action: string;
  /** Why, in her language. e.g. "你让它看看今天拍的照片有没有拍糊" */
  reason: string;
}

/**
 * THE GATE. Call this before the AI performs any out-of-app action.
 * Returns true only when she allows it (this time or via saved preference).
 * Never throws — a popup failure resolves to deny (fail closed).
 */
export async function requestAiAuthorization(req: AiAuthRequest): Promise<boolean> {
  if (!isCapabilityId(req.capability)) return false;
  const prefs = getAiAuthPreferences();
  const decision = decideFromPreference(prefs[req.capability]);
  if (decision === "allow") return true;
  if (decision === "deny") return false;
  try {
    const choice = await showAuthPopup(req);
    if (choice === "once") return true;
    if (choice === "always") {
      await setAiAuthPreference(req.capability, "always");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
