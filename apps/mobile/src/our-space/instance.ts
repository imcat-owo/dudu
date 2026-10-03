/**
 * Our Space store singleton (React Native side).
 * Backed by AsyncStorage; the pure OurSpaceStore stays unit-testable.
 * The same instance is shared by the UI and the AI tools so writes from
 * dialog appear live in the space (the store emits to subscribers).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { OurSpaceStore } from "./store";

export const ourSpaceStore = new OurSpaceStore(AsyncStorage);
