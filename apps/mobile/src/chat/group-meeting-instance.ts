/**
 * App-wide singleton for group meetings (vision feature 3).
 * UI and AI tools share it so both sides see the same meetings.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GroupMeetingStore } from "./group-meeting-store.js";

export const groupMeetingStore = new GroupMeetingStore(AsyncStorage);
