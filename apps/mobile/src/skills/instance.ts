/** Shared AsyncStorage-backed skill store singleton. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SkillStore } from "./store";

export const skillStore = new SkillStore(AsyncStorage);
