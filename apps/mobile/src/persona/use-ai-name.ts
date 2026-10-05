/**
 * React hook: the AI's display name (the name the user gave the AI).
 * Loads the active persona's name once, then refreshes whenever the
 * persona store changes (rename / switch / delete).
 */

import { useEffect, useState } from "react";
import { t } from "../i18n";
import { getAiDisplayName } from "./ai-name";
import { personaStore } from "./stores";

export function useAiName(): string {
  const [name, setName] = useState(() => t("ai.defaultName"));
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getAiDisplayName(t, personaStore).then((n) => {
        if (alive) setName(n);
      });
    };
    refresh();
    const unsub = personaStore.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return name;
}
