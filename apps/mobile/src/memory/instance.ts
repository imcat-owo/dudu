/**
 * AI memory system — store singleton (React Native side).
 * Backed by AsyncStorage; the pure MemoryStore stays unit-testable.
 * The same instance is shared by the AI tools and the garden UI so
 * writes from dialog appear live in 记忆花园.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { MemoryStore } from "./store";

export const memoryStore = new MemoryStore(AsyncStorage);
