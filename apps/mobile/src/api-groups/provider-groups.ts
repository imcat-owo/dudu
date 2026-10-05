/**
 * B4: user-defined provider groups — HER categories, not the app's.
 *
 * The capability auto-groups (capability-groups.ts) sort groups by what
 * the MODEL can do. These are different: named buckets she defines
 * herself ("主力", "白嫖", "画图专用") + a manual order. Learned from
 * Kelivo's provider_groups_page.dart.
 *
 * Stored as a plain JSON doc in AsyncStorage (not secret). Groups
 * reference ApiGroup ids; unknown ids are ignored on read.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_GROUPS_KEY = "dudu.api-groups.user-groups.v1";

export interface UserProviderGroup {
  id: string;
  name: string;
  /** ApiGroup ids in display order. */
  groupIds: string[];
  createdAt: number;
}

export function newUserGroupId(): string {
  return `ug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parse(raw: string | null): UserProviderGroup[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is UserProviderGroup =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as UserProviderGroup).id === "string" &&
        typeof (g as UserProviderGroup).name === "string" &&
        Array.isArray((g as UserProviderGroup).groupIds),
    );
  } catch {
    return [];
  }
}

export async function loadUserGroups(): Promise<UserProviderGroup[]> {
  try {
    return parse(await AsyncStorage.getItem(USER_GROUPS_KEY));
  } catch {
    return [];
  }
}

export async function saveUserGroups(groups: UserProviderGroup[]): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Non-fatal; the UI keeps the in-memory copy.
  }
}

/** Drop references to deleted groups. Pure. */
export function pruneUserGroups(
  userGroups: UserProviderGroup[],
  liveGroupIds: Set<string>,
): UserProviderGroup[] {
  return userGroups.map((ug) => ({
    ...ug,
    groupIds: ug.groupIds.filter((id) => liveGroupIds.has(id)),
  }));
}
