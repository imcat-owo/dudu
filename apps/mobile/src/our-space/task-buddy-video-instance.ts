/**
 * Task buddy video store singleton (React Native side).
 * Backed by AsyncStorage; the pure TaskBuddyVideoStore stays unit-testable.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { TaskBuddyVideoStore } from "./task-buddy-video";

export const taskBuddyVideoStore = new TaskBuddyVideoStore(AsyncStorage);
