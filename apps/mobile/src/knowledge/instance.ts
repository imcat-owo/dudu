/**
 * Knowledge base — store singleton (React Native side).
 * Backed by AsyncStorage; the pure KnowledgeStore stays unit-testable.
 * Shared by the AI tools and the knowledge UI so dialog and screen agree.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { KnowledgeStore } from "./store";

export const knowledgeStore = new KnowledgeStore(AsyncStorage);
