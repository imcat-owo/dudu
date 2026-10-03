import { View } from "react-native";
import { t } from "./i18n";
import { useColors, useStyles } from "./ui";
import { TText } from "./font";

interface DateFieldsProps {
  label: string;
  date: string;
  time: string;
  allDay: boolean;
  onChange: (date: string, time: string) => void;
}
export default function DateFields({ label, date, time, allDay, onChange }: DateFieldsProps) {
  const colors = useColors();
  const s = useStyles();
  const style = {
    border: `1px solid ${colors.line}`,
    borderRadius: 12,
    padding: 13,
    fontSize: 14,
    color: colors.text,
    background: colors.card,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box" as const,
    minHeight: 46,
  };
  return (
    <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
      <View style={{ flex: 1.2, gap: 7 }}>
        <TText style={[s.small, { fontWeight: "600", color: colors.text }]}>{label} date</TText>
        <input
          aria-label={t("datetime.dateLabel", { label })}
          type="date"
          value={date}
          onChange={(e) => onChange(e.target.value, time)}
          style={style}
        />
      </View>
      {!allDay && (
        <View style={{ flex: 1, gap: 7 }}>
          <TText style={[s.small, { fontWeight: "600", color: colors.text }]}>{label} time</TText>
          <input
            aria-label={t("datetime.timeLabel", { label })}
            type="time"
            value={time}
            onChange={(e) => onChange(date, e.target.value)}
            style={style}
          />
        </View>
      )}
    </View>
  );
}
