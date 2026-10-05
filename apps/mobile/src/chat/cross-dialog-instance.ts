/**
 * App-wide singletons for the cross-dialog audit trace + visibility
 * settings (vision feature 2). UI and AI tools share these so both sides
 * see the same trace.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CrossDialogTraceStore, CrossDialogVisibilityStore } from "./cross-dialog-trace";

export const crossDialogTraceStore = new CrossDialogTraceStore(AsyncStorage);
export const crossDialogVisibilityStore = new CrossDialogVisibilityStore(AsyncStorage);
