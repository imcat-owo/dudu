/**
 * Persona / world book / GLOBAL.md store singletons.
 *
 * The modules under ./persona are PURE (no React Native imports) so they
 * stay testable; this file wires them to AsyncStorage for the app.
 * local-agent.ts and the settings UI import from here.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createGlobalMdStore } from "./global-md";
import { createPersonaStore } from "./store";
import { createWorldBookStore } from "./world-book-store";

/** App-wide singleton: personas + tags + active persona. */
export const personaStore = createPersonaStore(AsyncStorage);

/** App-wide singleton: her hand-written GLOBAL.md. */
export const globalMdStore = createGlobalMdStore(AsyncStorage);

/** App-wide singleton: world books (lorebooks). */
export const worldBookStore = createWorldBookStore(AsyncStorage);
