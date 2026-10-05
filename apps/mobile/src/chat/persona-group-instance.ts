/**
 * App-wide singletons for persona group chat (人设群聊).
 * UI and AI tools share them so both sides see the same groups.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PersonaGroupStore } from "./persona-group-store";

export const personaGroupStore = new PersonaGroupStore(AsyncStorage);
