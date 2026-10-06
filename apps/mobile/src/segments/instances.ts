/**
 * 真人式分段发送 — app singletons.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SegmentStore } from "./store";

export const segmentStore = new SegmentStore(AsyncStorage);
