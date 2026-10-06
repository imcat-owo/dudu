/**
 * 用户照片涂鸦回应 — app singletons and production wiring.
 *
 * The composer (compose.tsx) pulls react-native-svg / view-shot — it is
 * LAZY-imported so node tests (and any non-RN consumer) can import this
 * module without dragging the native view hierarchy along. The tool
 * rejects honestly when the composer isn't ready.
 */

import { Image } from "react-native";
import type { DoodleAction } from "./doodle";
import { createDoodleTools, type DoodleToolEnv } from "./tools";

const productionEnv: DoodleToolEnv = {
  compose: async (photoUri: string, width: number, height: number, actions: DoodleAction[]) => {
    const { requestDoodleCompose } = await import("./compose");
    return requestDoodleCompose(photoUri, width, height, actions);
  },
  getImageSize: (uri) =>
    new Promise((resolve, reject) => {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        (e) => reject(e instanceof Error ? e : new Error(String(e))),
      );
    }),
};

/** Production AI-tool set for local-agent wiring. */
export function createProductionDoodleTools() {
  return createDoodleTools(productionEnv);
}
