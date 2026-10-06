/**
 * Personality dials （人格维度滑杆） — per-persona slider UI.
 *
 * Lives in the persona editor: five 0–100 dials (粘人/活泼/浪漫/主动/
 * 幽默）. Changes save IMMEDIATELY through the dials store — no editor
 * Save needed, no restart: the next turn's system prompt carries them.
 * Per-dial reset + reset-all + master toggle. Only SHE can drag them;
 * the AI has no tool for this (by design).
 */

import { RotateCcw } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { dialsStore } from "./instances";
import { DEFAULT_DIAL_VALUE, DIAL_DEFS, type DialId } from "./types";

function DialSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const colors = useColors();
  const viewRef = useRef<View>(null);
  const metrics = useRef({ width: 0, pageX: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const measure = () => {
    viewRef.current?.measure((_x, _y, width, _h, pageX) => {
      metrics.current = { width, pageX };
    });
  };

  const setFromPageX = (pageX: number) => {
    const { width, pageX: originX } = metrics.current;
    if (width > 0) {
      onChangeRef.current(
        Math.round(Math.min(100, Math.max(0, ((pageX - originX) / width) * 100))),
      );
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        measure();
        setFromPageX(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => setFromPageX(e.nativeEvent.pageX),
    }),
  ).current;

  const pct = Math.round(value);
  return (
    <View
      ref={viewRef}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={label}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onChangeRef.current(Math.min(100, pct + 5));
        else if (e.nativeEvent.actionName === "decrement")
          onChangeRef.current(Math.max(0, pct - 5));
      }}
      onLayout={measure}
      {...pan.panHandlers}
      style={{ height: 36, justifyContent: "center" }}
    >
      <View
        style={{
          height: 8,
          borderRadius: radii.xs,
          backgroundColor: colors.secondaryBg,
          borderWidth: 1,
          borderColor: colors.line,
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.blue }} />
      </View>
      <View
        style={{
          position: "absolute",
          left: `${pct}%`,
          marginLeft: -9,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: colors.blue,
        }}
      />
    </View>
  );
}

export function DialsSection({ personaId }: { personaId: string }) {
  const colors = useColors();
  const s = useStyles();
  const [values, setValues] = useState<Record<DialId, number>>({
    clingy: DEFAULT_DIAL_VALUE,
    playful: DEFAULT_DIAL_VALUE,
    romantic: DEFAULT_DIAL_VALUE,
    proactive: DEFAULT_DIAL_VALUE,
    humor: DEFAULT_DIAL_VALUE,
  });
  const [enabled, setEnabled] = useState(true);

  const refresh = () => {
    void (async () => {
      try {
        setValues(await dialsStore.get(personaId));
        setEnabled(await dialsStore.isEnabled());
      } catch {
        // ignore — UI shows what it can
      }
    })();
  };

  useEffect(refresh, [personaId]);

  const change = (id: DialId, v: number) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    void dialsStore.set(personaId, id, v).catch(() => {});
  };

  const resetOne = (id: DialId) => {
    change(id, DEFAULT_DIAL_VALUE);
  };

  const resetAll = () => {
    void (async () => {
      try {
        await dialsStore.reset(personaId);
      } catch {
        // ignore
      } finally {
        refresh();
      }
    })();
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    void dialsStore.setEnabled(on).catch(() => {});
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("dials.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("dials.section.desc")}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      <View style={{ marginTop: 12, gap: 14 }}>
        {DIAL_DEFS.map((d) => (
          <View key={d.id}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <TText style={{ fontSize: 14, fontWeight: "600" }}>
                {t(`dials.dim.${d.id}` as Parameters<typeof t>[0])}
              </TText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TText style={[s.small, { color: colors.muted }]}>{values[d.id]}</TText>
                <Pressable
                  accessibilityLabel={t("dials.actions.reset") as string}
                  onPress={() => resetOne(d.id)}
                  style={{ padding: 6, borderRadius: radii.sm }}
                >
                  <RotateCcw size={14} color={colors.muted} />
                </Pressable>
              </View>
            </View>
            <DialSlider
              value={values[d.id]}
              onChange={(v) => change(d.id, v)}
              label={t(`dials.dim.${d.id}` as Parameters<typeof t>[0]) as string}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -2 }}>
              <TText style={[s.small, { color: colors.muted }]}>
                {t(`dials.dim.${d.id}.low` as Parameters<typeof t>[0])}
              </TText>
              <TText style={[s.small, { color: colors.muted }]}>
                {t(`dials.dim.${d.id}.high` as Parameters<typeof t>[0])}
              </TText>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={resetAll}
        style={{
          marginTop: 14,
          padding: 8,
          borderRadius: radii.sm,
          borderWidth: 1,
          borderColor: colors.line,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RotateCcw size={14} color={colors.muted} />
        <TText style={[s.small, { color: colors.muted, marginLeft: 6 }]}>
          {t("dials.actions.resetAll")}
        </TText>
      </Pressable>

      <TText style={[s.small, { color: colors.muted, marginTop: 10 }]}>
        {t("dials.section.aiNote")}
      </TText>
    </Card>
  );
}
