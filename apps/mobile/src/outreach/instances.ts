/**
 * Proactive outreach — app singletons. Kept separate from the store so the
 * engine, scheduler, and tests can inject their own storage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OutreachStore } from "./store.js";

export const outreachStore = new OutreachStore(AsyncStorage);
