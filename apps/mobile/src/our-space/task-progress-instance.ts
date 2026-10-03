/**
 * Task progress store singleton (React Native side).
 * Backed by AsyncStorage; the pure TaskProgressStore stays unit-testable.
 * Shared by UI and app code so background work reports live progress.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { TaskProgressStore } from "./task-progress";

export const taskProgressStore = new TaskProgressStore(AsyncStorage);
