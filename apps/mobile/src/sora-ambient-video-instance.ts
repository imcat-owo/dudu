/**
 * Ambient video store singleton (React Native side).
 * Backed by AsyncStorage; the pure AmbientVideoStore stays unit-testable.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AmbientVideoStore } from "./sora-ambient-video";

export const ambientVideoStore = new AmbientVideoStore(AsyncStorage);
