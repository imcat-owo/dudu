/**
 * Production wiring for the avatar celebration store (A3 P2-1).
 *
 * Persists the anniversary once-per-day guard in AsyncStorage so it
 * survives app restarts. Same pattern as our-space/task-progress-instance.ts:
 * the pure store module takes an injectable storage, this module binds the
 * production one. Imported by our-space-ui.tsx (the only production trigger
 * site) — module load runs before any effect can fire.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setCelebrationStorage } from "./avatar-celebration";

setCelebrationStorage(AsyncStorage);
