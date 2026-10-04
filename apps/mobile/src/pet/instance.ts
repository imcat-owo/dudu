/**
 * Pet store singleton (React Native side).
 * Backed by AsyncStorage; the pure PetStore stays unit-testable.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PetStore } from "./store";

export const petStore = new PetStore(AsyncStorage);
