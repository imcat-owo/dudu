/**
 * 记忆 Mind Map 图谱视图 — SVG nodes + edges, tap a node to jump to
 * the memory. Read-only visualization; edges come from real metadata
 * (see mindmap/layout.ts), never invented.
 */

import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";
import { TText } from "../font";
import { t } from "../i18n";
import type { MemoryRecord } from "../memory/types";
import { gardenStateOf } from "../memory/types";
import { radii } from "../theme/radii";
import { useTheme } from "../theme/ThemeContext";
import { useColors } from "../ui";
import { buildMindMap } from "./layout";

const STATE_COLOR: Record<string, string> = {
  blooming: "#7fd69a",
  sprouting: "#c9b458",
  ask: "#6db9ff",
  wilted: "#9a9a9a",
};

export function MindMapView({
  records,
  onSelect,
}: {
  records: MemoryRecord[];
  onSelect: (id: string) => void;
}) {
  const colors = useColors();
  const { tokens } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const map = useMemo(() => buildMindMap(records), [records]);
  const nodeById = useMemo(() => new Map(map.nodes.map((nd) => [nd.id, nd])), [map]);
  const selected = selectedId ? (records.find((r) => r.id === selectedId) ?? null) : null;

  const pick = (id: string) => {
    setSelectedId(id);
    onSelect(id);
  };

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.line,
          overflow: "hidden",
        }}
      >
        <Svg width="100%" height={320} viewBox="0 0 100 100">
          {map.edges.map((e) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            return (
              <Line
                key={`${e.from}|${e.to}|${e.kind}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={e.kind === "supersedes" ? tokens.accent.fg : colors.line}
                strokeWidth={e.kind === "supersedes" ? 0.7 : 0.4}
                strokeDasharray={e.kind === "supersedes" ? "1.6 1" : undefined}
                opacity={0.8}
              />
            );
          })}
          {map.nodes.map((nd) => {
            const sel = nd.id === selectedId;
            return (
              <G key={nd.id} onPress={() => pick(nd.id)}>
                {/* Fat invisible hit area — nodes are small. */}
                <Circle cx={nd.x} cy={nd.y} r={Math.max(5, nd.r + 2.5)} fill="transparent" />
                <Circle
                  cx={nd.x}
                  cy={nd.y}
                  r={nd.r}
                  fill={STATE_COLOR[nd.state] ?? colors.muted}
                  opacity={0.9}
                  stroke={sel ? colors.text : "transparent"}
                  strokeWidth={sel ? 0.8 : 0}
                />
                <SvgText
                  x={nd.x}
                  y={nd.y + nd.r + 3.4}
                  fontSize={2.6}
                  fill={colors.muted}
                  textAnchor="middle"
                >
                  {nd.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
      {/* Legend — honest about what edges mean. */}
      <View style={{ flexDirection: "row", gap: 14, marginLeft: 4 }}>
        <TText style={{ color: colors.muted, fontSize: 11.5 }}>
          {t("space.garden.mapLegendTogether")}
        </TText>
        <TText style={{ color: colors.muted, fontSize: 11.5 }}>
          {t("space.garden.mapLegendSupersedes")}
        </TText>
      </View>
      {selected && (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.line,
            borderLeftWidth: 3,
            borderLeftColor: STATE_COLOR[gardenStateOf(selected)] ?? colors.muted,
            padding: 15,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <TText style={{ flex: 1, color: colors.muted, fontSize: 12 }}>
              {new Date(selected.validFrom).toLocaleDateString()}
            </TText>
            <Pressable onPress={() => setSelectedId(null)} accessibilityRole="button">
              <TText style={{ color: colors.muted, fontSize: 12 }}>{t("common.close")}</TText>
            </Pressable>
          </View>
          <TText style={{ color: colors.text, fontSize: 13.5, lineHeight: 22 }}>
            {selected.content}
          </TText>
        </View>
      )}
    </View>
  );
}
