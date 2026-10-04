import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  Inbox,
  Link2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  Artifact,
  BrowserSession,
  CalendarEvent,
  EmailDraft,
} from "../../../packages/domain/src";
import { API_URL } from "./api";
import AIBrowserView from "./browser/AIBrowserView";
import { localDateTime, zonedInstant } from "./date-time";
import { TText } from "./font";
import { t } from "./i18n";
import { radii } from "./theme/radii";
import {
  Button,
  Card,
  Chip,
  dateLabel,
  Empty,
  ErrorNotice,
  IconButton,
  LinkRow,
  Mascot,
  relativeDate,
  resultSummary,
  SectionHeading,
  Sheet,
  timeLabel,
  useColors,
  useStyles,
} from "./ui";
import { useWorkspace } from "./workspace";

function todayDate() {
  return localDateTime(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)
    .date;
}
function eventDate(event: CalendarEvent) {
  return event.allDay ? event.start : localDateTime(event.start, event.timeZone).date;
}
export function TodayScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, navigate, open, ask } = useWorkspace();
  const wide = useWindowDimensions().width > 1180;
  const pending = w.actions.filter((a) => a.status === "awaiting_review");
  const unread = w.mail.filter((m) => m.unread);
  const today = todayDate();
  const events = w.events
    .filter((e) => eventDate(e) === today)
    .sort((a, b) => a.start.localeCompare(b.start));
  return (
    <View style={{ gap: 25 }}>
      <View
        style={[
          {
            backgroundColor: "#E8F2F8",
            borderRadius: radii.xl,
            padding: 32,
            minHeight: 228,
            overflow: "hidden",
          },
          s.row,
        ]}
      >
        <View style={{ flex: 1, gap: 15, zIndex: 1 }}>
          <View style={[s.row, { gap: 7 }]}>
            <Sparkles size={13} color={colors.blueDark} />
            <TText style={[s.label, { color: colors.blueDark }]}>{t("today.kicker")}</TText>
          </View>
          <TText
            style={{
              fontSize: wide ? 39 : 29,
              lineHeight: wide ? 45 : 36,
              letterSpacing: -1.7,
              fontWeight: "500",
              color: colors.text,
            }}
          >
            {t("today.headline")}
          </TText>
          <TText style={[s.muted, { maxWidth: 420 }]}>
            {events.length
              ? t("today.thingsOnCalendar", { count: events.length })
              : t("today.calendarRoom")}
            {unread.length ? t("today.unreadEmails", { count: unread.length }) : ""}
            {t("today.makeSpace")}
          </TText>
          <Button
            onPress={() => ask(t("today.planDay"))}
            icon={Sparkles}
            primary
            style={{ alignSelf: "flex-start", marginTop: 5 }}
          >
            {t("today.planDay")}
          </Button>
        </View>
        {wide && (
          <View style={{ width: 220, height: 210, alignItems: "center", justifyContent: "center" }}>
            <View
              style={{
                position: "absolute",
                width: 190,
                height: 190,
                borderRadius: 100,
                backgroundColor: "#DAEAF2",
              }}
            />
            <View
              style={{
                position: "absolute",
                width: 145,
                height: 145,
                borderRadius: 80,
                borderWidth: 1,
                borderColor: "#C8DBE6",
              }}
            />
            <Mascot size={94} />
            <View
              style={[
                s.row,
                {
                  position: "absolute",
                  top: 17,
                  left: -19,
                  padding: 11,
                  gap: 7,
                  backgroundColor: colors.card,
                  borderRadius: radii.md,
                  transform: [{ rotate: "-7deg" }],
                },
              ]}
            >
              <Check size={14} color="#739174" />
              <TText style={s.small}>{t("today.easyDay")}</TText>
            </View>
            <View
              style={[
                s.row,
                {
                  position: "absolute",
                  bottom: 18,
                  right: -8,
                  padding: 12,
                  gap: 8,
                  backgroundColor: colors.card,
                  borderRadius: radii.md,
                  transform: [{ rotate: "5deg" }],
                },
              ]}
            >
              <CalendarDays size={17} color={colors.blueDark} />
              <TText style={s.small}>{t("today.allTogether")}</TText>
            </View>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 13, flexWrap: "wrap" }}>
        {[
          {
            label: t("today.unreadLabel"),
            value: unread.length,
            note: t("today.unreadNote"),
            icon: Mail,
            section: "mail" as const,
            tint: colors.sky,
          },
          {
            label: t("today.onCalendar"),
            value: events.length,
            note: t("today.calendarNote"),
            icon: CalendarDays,
            section: "calendar" as const,
            tint: colors.green,
          },
          {
            label: t("today.waitingLabel"),
            value: pending.length,
            note: t("today.waitingNote"),
            icon: ShieldCheck,
            section: "activity" as const,
            tint: colors.lavender,
          },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={() => navigate(item.section)}
            style={{ flex: 1, minWidth: 180 }}
          >
            <Card style={{ padding: 21, height: 126 }}>
              <View style={s.between}>
                <TText style={[s.label, { fontSize: 9, letterSpacing: 1 }]}>{item.label}</TText>
                <View
                  style={[
                    s.iconBox,
                    { width: 31, height: 31, borderRadius: radii.sm, backgroundColor: item.tint },
                  ]}
                >
                  <item.icon size={15} color={colors.text} />
                </View>
              </View>
              <TText style={{ fontSize: 29, color: colors.text, letterSpacing: -1, marginTop: -2 }}>
                {String(item.value).padStart(2, "0")}
              </TText>
              <TText style={[s.small, { fontSize: 10, marginTop: 3 }]}>{item.note}</TText>
            </Card>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 22 }}>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title={t("today.calendarLabel")}
            action={t("today.fullCalendar")}
            onPress={() => navigate("calendar")}
          />
          {events.length ? (
            events.slice(0, 3).map((e, i) => <AgendaRow key={e.id} event={e} index={i} />)
          ) : (
            <Empty
              icon={CalendarDays}
              title={t("today.breathingRoom")}
              detail={t("today.noEvents")}
            />
          )}
          <Pressable
            onPress={() => open({ type: "event" })}
            style={[
              s.row,
              {
                gap: 8,
                paddingTop: 15,
                marginTop: 9,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              },
            ]}
          >
            <Plus size={15} color={colors.muted} />
            <TText style={s.small}>{t("today.scheduleTime")}</TText>
          </Pressable>
        </Card>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title={t("today.fromInbox")}
            action={t("today.openMail")}
            onPress={() => navigate("mail")}
          />
          {w.mail.length ? (
            w.mail.slice(0, 3).map((m, i) => (
              <Pressable
                key={m.id}
                onPress={() => open({ type: "mail", mail: m })}
                style={[
                  s.row,
                  {
                    gap: 12,
                    paddingVertical: 13,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                ]}
              >
                <Avatar name={m.sender} index={i} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.between}>
                    <TText style={[s.text, { fontSize: 12, fontWeight: "600" }]}>{m.sender}</TText>
                    <TText style={[s.small, { fontSize: 10 }]}>{timeLabel(m.date)}</TText>
                  </View>
                  <TText numberOfLines={1} style={[s.text, { fontSize: 12, lineHeight: 18 }]}>
                    {m.subject}
                  </TText>
                  <TText numberOfLines={1} style={[s.small, { fontSize: 11 }]}>
                    {m.body.replace(/\n/g, " ")}
                  </TText>
                </View>
                {m.unread && (
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: radii.xs,
                      backgroundColor: "#78ABD0",
                    }}
                  />
                )}
              </Pressable>
            ))
          ) : (
            <Empty icon={Inbox} title={t("today.inboxQuiet")} detail={t("today.connectGoogle")} />
          )}
        </Card>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 22 }}>
        <Card style={{ flex: 1, backgroundColor: colors.card }}>
          <SectionHeading title={t("today.smallThings")} />
          <TText style={[s.muted, { marginBottom: 15 }]}>{t("today.startWithIdea")}</TText>
          {[t("today.prompt.attention"), t("today.prompt.inbox"), t("today.prompt.docs")].map(
            (prompt) => (
              <Pressable
                key={prompt}
                onPress={() => ask(prompt)}
                style={[
                  s.between,
                  { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 13 },
                ]}
              >
                <TText style={[s.text, { fontSize: 12 }]}>{prompt}</TText>
                <ArrowUpRight size={15} color={colors.muted} />
              </Pressable>
            ),
          )}
        </Card>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title={pending.length ? t("today.readyReview") : t("today.recentActivity")}
            action={t("today.viewAll")}
            onPress={() => navigate("activity")}
          />
          {pending.length
            ? pending
                .slice(0, 3)
                .map((a) => (
                  <LinkRow
                    key={a.id}
                    title={a.title}
                    detail={t("today.preparedWaiting")}
                    onPress={() => open({ type: "review", action: a })}
                    icon={ShieldCheck}
                    tint={colors.lavender}
                  />
                ))
            : w.activity.slice(0, 3).map((a) => (
                <View key={a.id} style={[s.row, { gap: 13, paddingVertical: 12 }]}>
                  <View
                    style={[s.iconBox, { width: 32, height: 32, backgroundColor: colors.green }]}
                  >
                    <Check size={14} color={colors.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TText style={[s.text, { fontSize: 12 }]}>{a.title}</TText>
                    <TText style={s.small}>{relativeDate(a.date)}</TText>
                  </View>
                </View>
              ))}
          {!pending.length && !w.activity.length && (
            <TText style={s.muted}>{t("today.workspaceReady")}</TText>
          )}
        </Card>
      </View>
    </View>
  );
}
function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 35,
        height: 35,
        borderRadius: radii.md,
        backgroundColor: [colors.orange, colors.lavender, colors.green, colors.sky][index % 4],
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <TText style={{ color: colors.text, fontSize: 11, fontWeight: "500" }}>
        {name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </TText>
    </View>
  );
}
export function AgendaRow({
  event: e,
  index = 0,
  neighbors,
}: {
  event: CalendarEvent;
  index?: number;
  neighbors?: CalendarEvent[];
}) {
  const colors = useColors();
  const s = useStyles();
  const { open } = useWorkspace();
  return (
    <Pressable
      onPress={() => open({ type: "event", event: e, neighbors })}
      style={[s.row, { gap: 16, paddingVertical: 14 }]}
    >
      <View style={{ width: 65 }}>
        <TText style={[s.text, { fontSize: 11 }]}>
          {e.allDay ? t("event.allDayShort") : timeLabel(e.start, e.timeZone)}
        </TText>
        {!e.allDay && (
          <TText style={[s.small, { fontSize: 10 }]}>{timeLabel(e.end, e.timeZone)}</TText>
        )}
      </View>
      <View
        style={{
          width: 3,
          height: 42,
          borderRadius: radii.xs,
          backgroundColor: ["#BCDAEB", "#C7D6AB", "#D9CDEA"][index % 3],
        }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <TText style={[s.text, { fontSize: 13, fontWeight: "500" }]}>{e.title}</TText>
        <TText numberOfLines={1} style={[s.small, { fontSize: 11 }]}>
          {e.location ||
            (e.attendees.length
              ? t("event.attendeeCount", { count: e.attendees.length })
              : t("event.timeForYou"))}
        </TText>
      </View>
      <ChevronRight size={14} color={colors.muted} />
    </Pressable>
  );
}
export function MailScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, open } = useWorkspace();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [drafts, setDrafts] = useState<(EmailDraft & { id: string; createdAt: string })[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .request<(EmailDraft & { id: string; createdAt: string })[]>("/api/drafts")
      .then(setDrafts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, w]);
  const items = w.mail.filter(
    (m) =>
      (tab !== "unread" || m.unread) &&
      `${m.sender} ${m.subject} ${m.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredDrafts = drafts.filter((d) =>
    `${d.to.join(" ")} ${d.subject} ${d.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View
          style={[
            s.row,
            {
              gap: 9,
              flex: 1,
              minWidth: 200,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radii.md,
              paddingHorizontal: 14,
            },
          ]}
        >
          <Search size={16} color={colors.muted} />
          <TextInput
            accessibilityLabel={t("a11y.searchMail")}
            placeholder={t("mail.searchPlaceholder")}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, paddingVertical: 13, fontSize: 13, color: colors.text }}
          />
        </View>
        <Button onPress={() => open({ type: "email" })} primary icon={Plus}>
          {t("mail.compose")}
        </Button>
      </View>
      <ErrorNotice error={error} />
      <Card>
        <View style={[s.row, { gap: 10, marginBottom: 15, flexWrap: "wrap" }]}>
          <Button small primary={tab === "all"} onPress={() => setTab("all")}>
            {t("mail.allMessages")}
          </Button>
          <Button small primary={tab === "unread"} onPress={() => setTab("unread")}>
            {t("mail.unreadTab", { count: w.mail.filter((m) => m.unread).length })}
          </Button>
          <Button small primary={tab === "drafts"} onPress={() => setTab("drafts")}>
            {t("mail.draftsTab", { count: drafts.length })}
          </Button>
        </View>
        {tab === "drafts" ? (
          filteredDrafts.length ? (
            filteredDrafts.map((d) => (
              <LinkRow
                key={d.id}
                icon={Mail}
                title={d.subject}
                detail={t("mail.draftDetail", {
                  to: d.to.join(", "),
                  date: dateLabel(d.createdAt),
                })}
                onPress={() => open({ type: "email", draft: d })}
              />
            ))
          ) : (
            <Empty icon={Mail} title={t("mail.freshPage")} detail={t("mail.draftsEmpty")} />
          )
        ) : items.length ? (
          items.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => open({ type: "mail", mail: m })}
              style={[
                s.row,
                { gap: 15, paddingVertical: 20, borderTopWidth: 1, borderTopColor: colors.line },
              ]}
            >
              <Avatar name={m.sender} index={i} />
              <View style={{ flex: 1, gap: 5 }}>
                <View style={s.between}>
                  <TText style={[s.text, { fontWeight: m.unread ? "600" : "400" }]}>
                    {m.sender}
                  </TText>
                  <TText style={s.small}>{dateLabel(m.date)}</TText>
                </View>
                <TText style={[s.text, { fontWeight: "500", fontSize: 13 }]}>{m.subject}</TText>
                <TText style={s.muted} numberOfLines={1}>
                  {m.body.replace(/\n/g, " ")}
                </TText>
                {!!m.attachments.length && (
                  <View style={[s.row, { gap: 4, marginTop: 2 }]}>
                    <FileText size={12} color={colors.muted} />
                    <TText style={s.small}>
                      {t("mail.attachmentCount", { count: m.attachments.length })}
                    </TText>
                  </View>
                )}
              </View>
              {m.unread && (
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: radii.xs,
                    backgroundColor: "#83B5D3",
                  }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Inbox}
            title={query ? t("mail.noMatch") : t("mail.emptyInbox")}
            detail={query ? t("mail.tryDifferent") : t("mail.connectGoogle")}
          />
        )}
      </Card>
    </View>
  );
}
interface CalendarChoice {
  id: string;
  name: string;
  timeZone: string;
  accessRole: string;
}
function plusDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function CalendarScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, open } = useWorkspace();
  const [date, setDate] = useState(todayDate());
  const [all, setAll] = useState(false);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [calendarId, setCalendarId] = useState("primary");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const selected = calendars.find((c) => c.id === calendarId);
  const zone = selected?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const writable = !selected || ["owner", "writer"].includes(selected.accessRole);
  const anchor = new Date(`${date}T12:00:00`);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(anchor);
    day.setDate(anchor.getDate() - anchor.getDay() + i);
    return day;
  });
  useEffect(() => {
    let active = true;
    void api
      .request<CalendarChoice[]>("/api/calendars")
      .then((items) => {
        if (!active) return;
        setCalendars(items);
        setCalendarId((current) =>
          items.some((c) => c.id === current) ? current : items[0]?.id || "primary",
        );
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, retry]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.resolve()
      .then(() => {
        const query = new URLSearchParams({
          calendarId,
          timeMin: zonedInstant(date, "00:00", zone),
          timeMax: zonedInstant(plusDays(date, all ? 30 : 1), "00:00", zone),
        });
        return api.request<CalendarEvent[]>(`/api/calendar/events?${query}`);
      })
      .then((items) => {
        if (active) setEvents(items.sort((a, b) => a.start.localeCompare(b.start)));
      })
      .catch((e) => {
        if (active) {
          setEvents([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, calendarId, date, all, zone, w, retry]);
  function newEvent() {
    open({
      type: "event",
      neighbors: events,
      draft: {
        calendarId,
        title: "",
        start: zonedInstant(date, "09:00", zone),
        end: zonedInstant(date, "10:00", zone),
        allDay: false,
        timeZone: zone,
        location: "",
        description: "",
        attendees: [],
      },
    });
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={[s.row, { gap: 8 }]}>
          <TText style={s.title}>
            {anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </TText>
          <IconButton
            icon={ChevronLeft}
            label={t("a11y.prevWeek")}
            onPress={() => setDate(plusDays(date, -7))}
          />
          <IconButton
            icon={ChevronRight}
            label={t("a11y.nextWeek")}
            onPress={() => setDate(plusDays(date, 7))}
          />
        </View>
        <Button primary icon={Plus} disabled={!writable} onPress={newEvent}>
          {t("cal.newEvent")}
        </Button>
      </View>
      {calendars.length > 0 && (
        <View style={{ gap: 9 }}>
          <TText style={s.label}>{t("cal.yourCalendars")}</TText>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {calendars.map((c) => (
              <Button
                key={c.id}
                small
                primary={c.id === calendarId}
                onPress={() => setCalendarId(c.id)}
              >
                {c.name}
                {["owner", "writer"].includes(c.accessRole) ? "" : t("cal.readOnly")}
              </Button>
            ))}
          </View>
        </View>
      )}
      <Card style={{ padding: 12 }}>
        <View style={{ flexDirection: "row", gap: 5 }}>
          {dates.map((day) => {
            const key = localDateTime(
              day.toISOString(),
              Intl.DateTimeFormat().resolvedOptions().timeZone,
            ).date;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setDate(key);
                  setAll(false);
                }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 17,
                  gap: 9,
                  borderRadius: radii.md,
                  backgroundColor: key === date ? colors.sky : "transparent",
                }}
              >
                <TText style={s.small}>
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </TText>
                <TText
                  style={[
                    s.title,
                    { fontSize: 22, color: key === date ? colors.blueDark : colors.text },
                  ]}
                >
                  {day.getDate()}
                </TText>
                <View
                  style={{
                    height: 4,
                    width: 4,
                    borderRadius: radii.xs,
                    backgroundColor: [...events, ...w.events].some(
                      (e) => e.calendarId === calendarId && eventDate(e) === key,
                    )
                      ? "#8DB6CA"
                      : "transparent",
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card>
        <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
          <TText style={s.heading}>
            {all
              ? t("cal.next30")
              : dateLabel(`${date}T12:00:00`, { weekday: "long", month: "long", day: "numeric" })}
          </TText>
          <Button small onPress={() => setAll(!all)}>
            {all ? t("cal.selectedDay") : t("cal.next30")}
          </Button>
        </View>
        <TText style={[s.small, { marginTop: 7, marginBottom: 13 }]}>
          {t("cal.tzNote", { name: selected?.name || t("cal.fallbackName"), zone })}
        </TText>
        <ErrorNotice error={error} />
        {!!error && (
          <Button small onPress={() => setRetry(retry + 1)}>
            {t("common.retry")}
          </Button>
        )}
        {loading ? (
          <View style={[s.row, { gap: 10, paddingVertical: 35, justifyContent: "center" }]}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <TText style={s.muted}>{t("cal.loading")}</TText>
          </View>
        ) : events.length ? (
          events.map((e, i) => (
            <View key={e.id}>
              {all && <TText style={[s.label, { marginTop: 16 }]}>{dateLabel(e.start)}</TText>}
              <AgendaRow event={e} index={i} neighbors={events} />
              <TText style={[s.small, { marginLeft: 84, marginBottom: 8 }]}>{e.timeZone}</TText>
            </View>
          ))
        ) : (
          !error && (
            <Empty
              icon={CalendarDays}
              title={t("cal.openSpace")}
              detail={all ? t("cal.nothing30") : t("cal.nothingDay")}
            >
              {writable && (
                <Button icon={Plus} onPress={newEvent}>
                  {t("cal.addEvent")}
                </Button>
              )}
            </Empty>
          )
        )}
      </Card>
    </View>
  );
}
export function BrowserScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setError("");
    setBusy(true);
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", { url });
      await refresh();
      setUrl("");
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 22 }}>
      <Card style={{ backgroundColor: colors.sky }}>
        <View style={[s.row, { gap: 12, marginBottom: 15 }]}>
          <Globe2 size={22} color={colors.blueDark} />
          <View>
            <TText style={s.heading}>{t("browser.tabPlace")}</TText>
            <TText style={s.muted}>{t("browser.privateBrowsing")}</TText>
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <TextInput
            accessibilityLabel={t("browser.addressLabel")}
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={() => void create()}
            autoCapitalize="none"
            placeholder="https://example.com"
            placeholderTextColor={colors.muted}
            style={[s.input, { flex: 1 }]}
          />
          <Button
            primary
            icon={Plus}
            busy={busy}
            disabled={!url.trim()}
            onPress={() => void create()}
          >
            {t("browser.openSession")}
          </Button>
        </View>
        <ErrorNotice error={error} />
      </Card>
      <Card>
        <SectionHeading title={t("browser.sessionsTitle")} />
        {w.browsers.length ? (
          w.browsers.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => open({ type: "browser", browser: b })}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingVertical: 20,
                gap: 12,
              }}
            >
              <View style={[s.row, { gap: 14 }]}>
                <View style={s.iconBox}>
                  <Globe2 size={20} color={colors.blueDark} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <TText style={s.heading}>{b.title || t("browser.untitled")}</TText>
                  <TText style={s.muted} numberOfLines={1}>
                    {b.url}
                  </TText>
                </View>
                <Chip tint={b.status === "active" ? colors.green : colors.canvas}>{b.status}</Chip>
                <ArrowUpRight size={17} color={colors.muted} />
              </View>
              {!!b.previewUrl && (
                <Image
                  source={{ uri: api.url(b.previewUrl) }}
                  resizeMode="cover"
                  style={{
                    height: 180,
                    width: "100%",
                    borderRadius: radii.md,
                    backgroundColor: colors.canvas,
                  }}
                />
              )}
            </Pressable>
          ))
        ) : (
          <Empty
            icon={Globe2}
            title={t("browser.startWithSite")}
            detail={t("browser.startDetail")}
          />
        )}
      </Card>
      <Card>
        <SectionHeading title={t("browser.aiBrowserTitle")} />
        <TText style={s.muted}>{t("browser.aiBrowserDetail")}</TText>
        <View style={{ height: 400, marginTop: 12 }}>
          <AIBrowserView visible />
        </View>
      </Card>
    </View>
  );
}
export function FilesScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setError("");
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      let artifact: Artifact;
      if (Platform.OS === "web") {
        const form = new FormData();
        if (!file.file) throw new Error(t("files.readError"));
        form.append("file", file.file, file.name);
        artifact = await api.request<Artifact>("/api/files", form);
      } else {
        const result = await FileSystem.uploadAsync(`${API_URL}/api/files`, file.uri, {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: "application/pdf",
          headers: { Authorization: `Bearer ${api.token}` },
        });
        const payload = JSON.parse(result.body);
        if (result.status < 200 || result.status >= 300)
          throw new Error(payload.error || t("files.importError"));
        artifact = payload;
      }
      await refresh();
      open({ type: "file", file: artifact });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={s.between}>
        <TText style={[s.muted, { flex: 1, marginRight: 15 }]}>{t("files.tagline")}</TText>
        <Button primary icon={Upload} busy={busy} onPress={() => void upload()}>
          {t("files.importPdf")}
        </Button>
      </View>
      <ErrorNotice error={error} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
        {w.files.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => open({ type: "file", file: f })}
            style={{ flexGrow: 1, flexBasis: 250, maxWidth: 430 }}
          >
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <View
                style={{
                  height: 175,
                  backgroundColor: "#EDEFEA",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 93,
                    height: 121,
                    borderRadius: radii.xs,
                    backgroundColor: colors.card,
                    padding: 14,
                    transform: [{ rotate: "-4deg" }],
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <View style={[s.row, { gap: 5, marginBottom: 15 }]}>
                    <FileText size={13} color={colors.blueDark} />
                    <TText style={{ fontSize: 7, color: colors.blueDark }}>DOCUMENT</TText>
                  </View>
                  {[100, 75, 90, 95, 60].map((width, i) => (
                    <View
                      key={width}
                      style={{
                        height: 3,
                        backgroundColor: i === 0 ? colors.blue : colors.line,
                        width: `${width}%`,
                        marginBottom: 7,
                        borderRadius: radii.xs,
                      }}
                    />
                  ))}
                </View>
                <View style={{ position: "absolute", bottom: 12, right: 14 }}>
                  <Chip>PDF</Chip>
                </View>
              </View>
              <View style={{ padding: 21, gap: 6 }}>
                <TText numberOfLines={1} style={[s.heading, { fontSize: 14 }]}>
                  {f.name}
                </TText>
                <TText style={s.small}>
                  {t("files.pageCount", { count: f.pageCount })} ·{" "}
                  {Math.max(1, Math.round(f.size / 1024))} KB
                </TText>
                <View style={[s.between, { marginTop: 9 }]}>
                  <Chip>{f.source}</Chip>
                  <TText style={s.small}>{dateLabel(f.createdAt)}</TText>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
      {!w.files.length && (
        <Card>
          <Empty icon={FileText} title={t("files.emptyTitle")} detail={t("files.emptyDetail")} />
        </Card>
      )}
    </View>
  );
}
export function ActivityScreen() {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, open } = useWorkspace();
  const [filter, setFilter] = useState("all");
  const pending = w.actions.filter((a) => a.status === "awaiting_review");
  const actions = w.actions.filter((a) => filter === "all" || a.status === "awaiting_review");
  return (
    <View style={{ gap: 20 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Button small primary={filter === "all"} onPress={() => setFilter("all")}>
          {t("activity.all")}
        </Button>
        <Button small primary={filter === "review"} onPress={() => setFilter("review")}>
          {t("activity.needsReview", { count: pending.length })}
        </Button>
      </View>
      {actions.length > 0 && (
        <Card>
          <SectionHeading title={t("activity.yourActions")} />
          {actions.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => open({ type: "review", action: a })}
              style={[
                s.row,
                { gap: 15, paddingVertical: 17, borderTopWidth: 1, borderTopColor: colors.line },
              ]}
            >
              <View
                style={[
                  s.iconBox,
                  {
                    backgroundColor:
                      a.status === "awaiting_review" ? colors.lavender : colors.green,
                  },
                ]}
              >
                {a.status === "awaiting_review" ? (
                  <ShieldCheck size={18} color={colors.text} />
                ) : (
                  <CheckCheck size={18} color={colors.text} />
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <TText style={s.text}>{a.title}</TText>
                <TText style={s.small}>{relativeDate(a.createdAt)}</TText>
              </View>
              <Chip
                tint={
                  a.status === "failed"
                    ? colors.errorBg
                    : a.status === "awaiting_review"
                      ? colors.lavender
                      : colors.canvas
                }
              >
                {a.status.replace(/_/g, " ")}
              </Chip>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      )}
      {filter === "all" && (
        <Card>
          <SectionHeading title={t("activity.timeline")} />
          {w.activity.length ? (
            w.activity.map((a, i) => (
              <View
                key={a.id}
                style={[
                  s.row,
                  {
                    alignItems: "flex-start",
                    gap: 17,
                    paddingVertical: 18,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                ]}
              >
                <View
                  style={[s.iconBox, { height: 34, width: 34, backgroundColor: colors.canvas }]}
                >
                  <Clock3 size={16} color={colors.muted} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <TText style={s.text}>{a.title}</TText>
                  <TText style={s.muted}>{resultSummary(a.detail)}</TText>
                  <TText style={s.small}>
                    {dateLabel(a.date)} · {timeLabel(a.date)}
                  </TText>
                </View>
                <Chip>{a.status}</Chip>
              </View>
            ))
          ) : (
            <Empty
              icon={Clock3}
              title={t("activity.emptyTimeline")}
              detail={t("activity.timelineNote")}
            />
          )}
        </Card>
      )}
      {filter === "review" && !actions.length && (
        <Card>
          <Empty
            icon={ShieldCheck}
            title={t("activity.caughtUp")}
            detail={t("activity.approvalNote")}
          />
        </Card>
      )}
    </View>
  );
}
export function ConnectionsScreen({ query = "" }: { query?: string }) {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, notify, open } = useWorkspace();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(capability: "read" | "write") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ url: string | null; connected?: boolean }>(
        "/api/google/connect",
        { capability },
      );
      if (result.url) {
        await Linking.openURL(result.url);
        notify(t("conn.finishBrowser"));
      } else {
        await refresh();
        notify(t("conn.localReady"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api.request("/api/google/disconnect", {});
      await refresh();
      notify(t("conn.disconnected"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const google = w.connections.find((c) => c.id === "google");
  const connected = google?.status === "connected" || google?.status === "sample";
  const rows = [
    { id: "gmail", name: "Gmail", icon: Mail, color: "#EA5B4D", connected, group: "google" },
    {
      id: "calendar",
      name: "Google Calendar",
      icon: CalendarDays,
      color: "#4285F4",
      connected,
      group: "google",
    },
    {
      id: "browser",
      name: t("conn.agentComputer"),
      icon: Globe2,
      color: "#1987CF",
      connected: w.connections.some((c) => c.id === "browser" && c.status === "connected"),
      group: "browser",
    },
    {
      id: "openbot",
      name: "OpenBot",
      icon: Sparkles,
      color: "#6866A6",
      connected: false,
      group: "openbot",
    },
  ].filter((row) => `${row.name} ${row.group}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <View style={{ gap: 22 }}>
      {[true, false].map((isConnected) => {
        const group = rows.filter((row) => row.connected === isConnected);
        if (!group.length) return null;
        return (
          <View key={String(isConnected)} style={{ gap: 8 }}>
            <TText style={[s.small, { marginLeft: 12 }]}>
              {isConnected
                ? w.mode === "sample"
                  ? t("conn.yourConnections")
                  : t("conn.connected")
                : t("conn.available")}
            </TText>
            <View
              style={{
                paddingHorizontal: 16,
                borderRadius: radii.xl,
                backgroundColor: colors.line,
              }}
            >
              {group.map((row, index) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("a11y.manageConn", { name: row.name })}
                  onPress={() =>
                    row.group === "browser" ? open({ type: "computer" }) : setSelected(row.group)
                  }
                  style={[
                    s.row,
                    {
                      gap: 14,
                      minHeight: 61,
                      borderBottomWidth: index < group.length - 1 ? 1 : 0,
                      borderBottomColor: colors.line,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 29,
                      height: 29,
                      borderRadius: radii.xs,
                      backgroundColor: colors.card,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <row.icon size={23} color={row.color} />
                  </View>
                  <TText style={[s.text, { flex: 1 }]}>{row.name}</TText>
                  {row.connected && row.group === "google" && w.mode === "sample" && (
                    <TText style={s.small}>{t("conn.localData")}</TText>
                  )}
                  {row.connected ? (
                    <ChevronRight size={18} color={colors.muted} />
                  ) : (
                    <TText
                      style={{
                        fontSize: 13,
                        color: row.group === "google" ? colors.blueDark : colors.muted,
                      }}
                    >
                      {row.group === "google" ? t("conn.connect") : t("conn.setup")}
                    </TText>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {!rows.length && <TText style={s.muted}>{t("conn.noMatch")}</TText>}
      {selected && (
        <Sheet
          title={selected === "google" ? t("conn.googleTitle") : "OpenBot"}
          subtitle={selected === "google" ? google?.account : t("conn.openbotSubtitle")}
          onClose={() => setSelected(undefined)}
        >
          {selected === "google" ? (
            <View style={{ gap: 18 }}>
              <TText style={s.muted}>{t("conn.googleIntro")}</TText>
              <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
                {google?.capabilities.map((cap) => (
                  <Chip key={cap}>{capabilityLabel(cap)}</Chip>
                ))}
              </View>
              <ErrorNotice error={error} />
              <Button busy={busy} primary icon={Link2} onPress={() => void connect("read")}>
                {t("conn.connectGoogle")}
              </Button>
              <Button busy={busy} onPress={() => void connect("write")}>
                {t("conn.enableWrite")}
              </Button>
              {connected && (
                <Button busy={busy} danger onPress={() => void disconnect()}>
                  {t("conn.disconnectGoogle")}
                </Button>
              )}
              <SettingsLine
                label={t("conn.environment")}
                value={w.mode === "sample" ? t("conn.localExample") : t("conn.liveWorkspace")}
              />
              <SettingsLine
                label={t("conn.assistant")}
                value={
                  w.runtime.provider === "sample"
                    ? t("conn.guided")
                    : w.runtime.configured
                      ? t("conn.modelConnected")
                      : t("conn.modelNotConfigured")
                }
              />
              <SettingsLine
                label={t("conn.richThreads")}
                value={w.runtime.richThreads ? "CopilotKit Intelligence" : t("conn.notConnected")}
              />
              <Button
                small
                icon={ArrowDownToLine}
                onPress={() => void refresh().catch((e) => setError(String(e)))}
              >
                {t("conn.refresh")}
              </Button>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <TText style={s.text}>{t("conn.openbotNote1")}</TText>
              <TText style={s.muted}>{t("conn.openbotNote2")}</TText>
            </View>
          )}
        </Sheet>
      )}
    </View>
  );
}
function SettingsLine({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View
      style={[
        s.between,
        { gap: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
      ]}
    >
      <TText style={s.muted}>{label}</TText>
      <TText style={[s.text, { fontSize: 12, flexShrink: 1, textAlign: "right" }]}>{value}</TText>
    </View>
  );
}

function capabilityLabel(value: string) {
  const scope = value.split("/").at(-1) || value;
  const names: Record<string, string> = {
    "gmail.readonly": t("scope.gmailReadonly"),
    "gmail.send": t("scope.gmailSend"),
    "calendar.events.readonly": t("scope.calEventsReadonly"),
    "calendar.calendarlist.readonly": t("scope.calListReadonly"),
    "calendar.events": t("scope.calEvents"),
    "calendar.readonly": t("scope.calReadonly"),
  };
  return names[scope] || scope;
}
