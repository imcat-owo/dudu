/**
 * Music room store singleton (React Native side).
 * Backed by AsyncStorage; the pure MusicStore stays unit-testable.
 * The same instance is shared by the UI and the AI tools so DJ commands
 * from dialog appear live in the music room (the store emits to subscribers).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { MusicStore } from "./store";

export const musicStore = new MusicStore(AsyncStorage);
