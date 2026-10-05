/**
 * H8 — App Lock settings UI.
 *
 * Enable toggle (requires a successful biometric check first),
 * idle re-lock timeout picker. All copy via i18n, 嘟嘟腔.
 */

import { Check } from "lucide-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors, useStyles } from "../ui";
import { APP_LOCK_IDLE_OPTIONS, appLockStore } from "./app-lock";

export function AppLockSection() {
  const colors = useColors();
  const s = useStyles();
  const state = useSyncExternalStore(appLockStore.subscribe, appLockStore.getState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void appLockStore.load();
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      const ok = await appLockStore.setEnabled(on);
      if (!ok && on) setNotice(t("platform.applock.enableFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pickIdle = (seconds: number) => {
    void appLockStore.setIdleSeconds(seconds);
  };

  return (
    <View>
      <SectionHeading title={t("platform.applock.title")} />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
        {t("platform.applock.hint")}
      </TText>

      {!state.enrolled && (
        <TText style={{ color: colors.danger, fontSize: 13, marginBottom: 10 }}>
          {t("platform.applock.noBiometric")}
        </TText>
      )}

      <View style={[s.row, s.between, { marginBottom: 12 }]}>
        <TText style={{ color: colors.text, fontSize: 15 }}>{t("platform.applock.enable")}</TText>
        <Switch
          value={state.enabled}
          disabled={busy || !state.enrolled}
          onValueChange={(v) => void toggle(v)}
        />
      </View>

      {state.enabled && (
        <View style={{ marginBottom: 12 }}>
          <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 8 }}>
            {t("platform.applock.idle")}
          </TText>
          {APP_LOCK_IDLE_OPTIONS.map((opt) => {
            const selected = state.idleSeconds === opt.seconds;
            return (
              <Pressable
                key={opt.seconds}
                accessibilityRole="button"
                onPress={() => pickIdle(opt.seconds)}
                style={[s.row, s.between, { paddingVertical: 9 }]}
              >
                <TText style={{ color: colors.text, fontSize: 15 }}>{t(opt.labelKey)}</TText>
                {selected ? <Check size={16} color={colors.blueDark} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {notice ? (
        <TText style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>{notice}</TText>
      ) : null}

      {state.locked && (
        <Button
          onPress={() =>
            void (async () => {
              const ok = await appLockStore.authenticate();
              if (!ok) Alert.alert(t("platform.applock.enableFailed"));
            })()
          }
        >
          {t("platform.applock.unlock")}
        </Button>
      )}
    </View>
  );
}
