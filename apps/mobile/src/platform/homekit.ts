/**
 * H10 — HomeKit bridge (TS side).
 *
 * Lets the AI control her smart home ("turn off the bedroom light").
 * Follows the AlarmKit pattern: TS side is complete, talks to the
 * `DuduHomeKit` native module when available (see
 * plugins/dudu-platform/homekit/), otherwise reports unavailable —
 * never faked.
 *
 * HomeKit requires the com.apple.developer.homekit entitlement and
 * user permission; the native module handles the HMHomeManager lifecycle.
 */

import { getNativeModule } from "./types";

export interface HomekitAccessory {
  id: string;
  name: string;
  room: string;
  category: string;
  reachable: boolean;
}

export interface HomekitCharacteristic {
  type: string;
  value: string | number | boolean;
  writable: boolean;
}

export interface HomekitScene {
  id: string;
  name: string;
}

async function loadModule(): Promise<{
  listAccessories(): Promise<HomekitAccessory[]>;
  getCharacteristics(accessoryId: string): Promise<HomekitCharacteristic[]>;
  setCharacteristic(
    accessoryId: string,
    type: string,
    value: string | number | boolean,
  ): Promise<boolean>;
  listScenes(): Promise<HomekitScene[]>;
  runScene(sceneId: string): Promise<boolean>;
} | null> {
  return getNativeModule<{
    listAccessories(): Promise<HomekitAccessory[]>;
    getCharacteristics(accessoryId: string): Promise<HomekitCharacteristic[]>;
    setCharacteristic(
      accessoryId: string,
      type: string,
      value: string | number | boolean,
    ): Promise<boolean>;
    listScenes(): Promise<HomekitScene[]>;
    runScene(sceneId: string): Promise<boolean>;
  }>("DuduHomeKit");
}

/** True when the native HomeKit module is linked and ready. */
export async function isHomeKitAvailable(): Promise<boolean> {
  return (await loadModule()) != null;
}

export async function listHomekitAccessories(): Promise<HomekitAccessory[]> {
  const mod = await loadModule();
  if (!mod) return [];
  try {
    return await mod.listAccessories();
  } catch {
    return [];
  }
}

export async function getHomekitCharacteristics(
  accessoryId: string,
): Promise<HomekitCharacteristic[]> {
  const mod = await loadModule();
  if (!mod) return [];
  try {
    return await mod.getCharacteristics(accessoryId);
  } catch {
    return [];
  }
}

export async function setHomekitCharacteristic(
  accessoryId: string,
  type: string,
  value: string | number | boolean,
): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.setCharacteristic(accessoryId, type, value);
  } catch {
    return false;
  }
}

export async function listHomekitScenes(): Promise<HomekitScene[]> {
  const mod = await loadModule();
  if (!mod) return [];
  try {
    return await mod.listScenes();
  } catch {
    return [];
  }
}

export async function runHomekitScene(sceneId: string): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.runScene(sceneId);
  } catch {
    return false;
  }
}
