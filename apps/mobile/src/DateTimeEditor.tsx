import { useEffect, useState } from "react";
import { View } from "react-native";
import DateFields from "./DateFields";
import { isCompleteInstant, localDateTime, zonedInstant } from "./date-time";
import { t } from "./i18n";
import { useColors, useStyles } from "./ui";
import { TText } from "./font";
export default function DateTimeEditor({
  label,
  value,
  timeZone,
  allDay,
  onChange,
}: {
  label: string;
  value: string;
  timeZone: string;
  allDay: boolean;
  onChange: (value: string) => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [date, setDate] = useState(value.slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      if (allDay) {
        setDate(value.slice(0, 10));
      } else if (isCompleteInstant(value)) {
        const local = localDateTime(value, timeZone);
        setDate(local.date);
        setTime(local.time);
      }
    } catch {
      setError(t("datetime.badTimezone"));
    }
  }, [value, timeZone, allDay]);
  function change(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    setError("");
    if (allDay) {
      onChange(nextDate);
      return;
    }
    try {
      onChange(zonedInstant(nextDate, nextTime, timeZone));
    } catch (e) {
      onChange(`${nextDate} ${nextTime}`);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <View>
      <DateFields label={label} date={date} time={time} allDay={allDay} onChange={change} />
      {!!error && (
        <TText style={[s.small, { color: colors.danger, marginBottom: 12 }]}>{error}</TText>
      )}
    </View>
  );
}
