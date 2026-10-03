import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  CalendarDays,
  Check,
  Clock3,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Mail as MailIcon,
  Reply,
  RotateCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, View } from "react-native";
import {
  type ActionProposal,
  type Artifact,
  type BrowserSession,
  type CalendarEvent,
  type EmailDraft,
  type EventDraft,
  emailDraftSchema,
  eventDraftSchema,
  type Mail,
  type ProposalInput,
} from "../../../packages/domain/src";
import { DelegateSheet, NotificationsSheet, TaskDetail } from "./agent-ui";
import BrowserConsole from "./BrowserConsole";
import { browserAddress, browserSite } from "./browser-address";
import { ComputerSheet } from "./computer";
import DateTimeEditor from "./DateTimeEditor";
import { localDateTime, zonedInstant } from "./date-time";
import { type StringKey, t } from "./i18n";
import PdfReader from "./PdfReader";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  dateLabel,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  SectionHeading,
  Sheet,
  timeLabel,
  useColors,
  useStyles,
} from "./ui";
import { type Detail, useWorkspace } from "./workspace";
import { TText } from "./font";
export function Details({ detail }: { detail: Detail }) {
  const { close, navigate } = useWorkspace();
  if (detail.type === "computer") return <ComputerSheet />;
  if (detail.type === "task") return <TaskDetail taskId={detail.taskId} />;
  if (detail.type === "delegate") return <DelegateSheet />;
  if (detail.type === "notifications") return <NotificationsSheet />;
  if (detail.type === "mail") return <MailDetail mail={detail.mail} />;
  if (detail.type === "email") return <EmailEditor draft={detail.draft} />;
  if (detail.type === "event")
    return <EventEditor event={detail.event} draft={detail.draft} neighbors={detail.neighbors} />;
  if (detail.type === "file") return <FileDetail file={detail.file} />;
  if (detail.type === "review") return <ReviewDetail initial={detail.action} />;
  if (detail.type === "browser") return <BrowserDetail initial={detail.browser} />;
  return (
    <Sheet title={t("detail.homeTitle")} subtitle={t("detail.homeSubtitle")} onClose={close}>
      {[
        { section: "mail" as const, title: t("section.mail.title"), icon: MailIcon },
        { section: "calendar" as const, title: t("section.calendar.title"), icon: CalendarDays },
        { section: "browser" as const, title: t("section.browser.title"), icon: Globe2 },
        { section: "files" as const, title: t("section.files.title"), icon: FileText },
        { section: "activity" as const, title: t("section.activity.title"), icon: Clock3 },
        {
          section: "connections" as const,
          title: t("section.connections.title"),
          icon: ShieldCheck,
        },
      ].map((item) => (
        <LinkRow
          key={item.section}
          title={item.title}
          icon={item.icon}
          onPress={() => {
            navigate(item.section);
            close();
          }}
        />
      ))}
    </Sheet>
  );
}
function MailDetail({ mail: m }: { mail: Mail }) {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, open, close } = useWorkspace();
  const [error, setError] = useState("");
  const [importing, setImporting] = useState("");
  async function importAttachment(reference: string) {
    setError("");
    setImporting(reference);
    try {
      const file = await api.request<Artifact>("/api/mail/import-attachment", { reference });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting("");
    }
  }
  const [thread, setThread] = useState<Mail[]>([m]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<Mail[]>(`/api/mail/threads/${encodeURIComponent(m.threadId)}`)
      .then((items) => {
        if (active) setThread(items.sort((a, b) => a.date.localeCompare(b.date)));
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, m.threadId, retry]);
  return (
    <Sheet
      title={m.subject}
      subtitle={t("mail.threadMessages", { count: thread.length })}
      onClose={close}
    >
      {loading && (
        <View style={[s.row, { gap: 10, paddingBottom: 20 }]}>
          <ActivityIndicator color={colors.blueDark} />
          <TText style={s.muted}>{t("chat.placeholder.loading")}</TText>
        </View>
      )}
      {thread.map((message) => (
        <Card key={message.id} style={{ marginBottom: 16 }}>
          <View style={s.between}>
            <View style={{ gap: 4, flex: 1 }}>
              <TText style={s.heading}>{message.sender}</TText>
              <TText style={s.small}>{message.from}</TText>
              <TText style={s.small}>
                {t("mail.to")}: {message.to.join(", ")}
              </TText>
            </View>
            <TText style={s.small}>
              {dateLabel(message.date)} · {timeLabel(message.date)}
            </TText>
          </View>
          <View style={s.divider} />
          <TText selectable style={[s.text, { lineHeight: 25 }]}>
            {message.body}
          </TText>
          {message.attachments.map((id) => {
            const file = w.files.find((f) => f.id === id);
            return file ? (
              <LinkRow
                key={id}
                title={file.name}
                detail={t("mail.pdfAttachment", { count: file.pageCount })}
                icon={FileText}
                onPress={() => open({ type: "file", file })}
              />
            ) : (
              <Button
                key={id}
                busy={importing === id}
                icon={FileText}
                onPress={() => void importAttachment(id)}
              >
                {decodeURIComponent(id.split(":").slice(2).join(":")) || t("mail.openAttachment")}
              </Button>
            );
          })}
        </Card>
      ))}
      <ErrorNotice error={error} />
      {!!error && (
        <Button onPress={() => setRetry(retry + 1)}>{t("mail.reloadConversation")}</Button>
      )}
      <Button
        primary
        icon={Reply}
        style={{ alignSelf: "flex-start" }}
        onPress={() =>
          open({
            type: "email",
            draft: {
              to: [m.from],
              subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
              body: "",
              cc: [],
              bcc: [],
              attachmentIds: [],
              threadId: m.threadId,
              replyToMessageId: m.id,
            },
          })
        }
      >
        {t("mail.writeReply")}
      </Button>
    </Sheet>
  );
}
function EmailEditor({ draft }: { draft?: Partial<EmailDraft> & { id?: string } }) {
  const s = useStyles();
  const { workspace: w, api, refresh, open, close, notify } = useWorkspace();
  const [to, setTo] = useState(draft?.to?.join(", ") || "");
  const [cc, setCc] = useState(draft?.cc?.join(", ") || "");
  const [bcc, setBcc] = useState(draft?.bcc?.join(", ") || "");
  const [subject, setSubject] = useState(draft?.subject || "");
  const [body, setBody] = useState(draft?.body || "");
  const [attachments, setAttachments] = useState(draft?.attachmentIds || []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  function emails(value: string) {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  async function save(review: boolean) {
    setBusy(review ? "review" : "draft");
    setError("");
    try {
      const parsed = emailDraftSchema.safeParse({
        to: emails(to),
        cc: emails(cc),
        bcc: emails(bcc),
        subject,
        body,
        attachmentIds: attachments,
        threadId: draft?.threadId,
        replyToMessageId: draft?.replyToMessageId,
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
        );
      if (review) {
        const action = await api.request<ActionProposal>("/api/actions", {
          kind: "email.send",
          data: parsed.data,
        });
        await refresh();
        open({ type: "review", action });
      } else {
        await api.request("/api/drafts", {
          ...parsed.data,
          ...(draft?.id ? { id: draft.id } : {}),
        });
        await refresh();
        notify(t("mail.draftSaved"));
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <Sheet
      title={draft?.threadId ? t("mail.replyTitle") : t("mail.newTitle")}
      subtitle={t("mail.editorSubtitle", { email: w.profile.email })}
      onClose={close}
    >
      <Field
        label={t("mail.to")}
        value={to}
        onChangeText={setTo}
        placeholder="person@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("mail.cc")}
            value={cc}
            onChangeText={setCc}
            placeholder={t("mail.optional")}
            autoCapitalize="none"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t("mail.bcc")}
            value={bcc}
            onChangeText={setBcc}
            placeholder={t("mail.optional")}
            autoCapitalize="none"
          />
        </View>
      </View>
      <Field
        label={t("mail.subject")}
        value={subject}
        onChangeText={setSubject}
        placeholder={t("mail.subjectPlaceholder")}
      />
      <Field
        label={t("mail.message")}
        value={body}
        onChangeText={setBody}
        multiline
        placeholder={t("mail.bodyPlaceholder")}
        style={{ minHeight: 210 }}
      />
      {w.files.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 18 }}>
          <TText style={[s.heading, { fontSize: 13, marginBottom: 5 }]}>
            {t("mail.attachments")}
          </TText>
          {w.files.map((f) => (
            <CheckRow
              key={f.id}
              checked={attachments.includes(f.id)}
              label={`${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`}
              onPress={() =>
                setAttachments(
                  attachments.includes(f.id)
                    ? attachments.filter((id) => id !== f.id)
                    : [...attachments, f.id],
                )
              }
            />
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button
          primary
          icon={ShieldCheck}
          busy={busy === "review"}
          disabled={!!busy}
          onPress={() => void save(true)}
        >
          {t("mail.reviewEmail")}
        </Button>
        <Button
          icon={Save}
          busy={busy === "draft"}
          disabled={!!busy}
          onPress={() => void save(false)}
        >
          {t("mail.saveDraft")}
        </Button>
      </View>
      <TText style={[s.small, { marginTop: 13 }]}>{t("mail.reviewNote")}</TText>
    </Sheet>
  );
}
function EventEditor({
  event: e,
  draft,
  neighbors,
}: {
  event?: CalendarEvent;
  draft?: EventDraft;
  neighbors?: CalendarEvent[];
}) {
  const colors = useColors();
  const s = useStyles();
  const seed = e || draft;
  const { workspace: w, api, open, close, refresh } = useWorkspace();
  const initialStart = new Date();
  initialStart.setMinutes(0, 0, 0);
  initialStart.setHours(initialStart.getHours() + 1);
  const [title, setTitle] = useState(seed?.title || "");
  const [start, setStart] = useState(seed?.start || initialStart.toISOString());
  const [end, setEnd] = useState(
    seed?.end || new Date(initialStart.getTime() + 3600000).toISOString(),
  );
  const [allDay, setAllDay] = useState(seed?.allDay || false);
  const [zone, setZone] = useState(
    seed?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [location, setLocation] = useState(seed?.location || "");
  const [description, setDescription] = useState(seed?.description || "");
  const [attendees, setAttendees] = useState(seed?.attendees.join(", ") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conflicts = (neighbors || w.events).filter(
    (item) =>
      item.id !== e?.id &&
      Date.parse(start) < Date.parse(item.end) &&
      Date.parse(end) > Date.parse(item.start),
  );
  async function propose(remove = false) {
    setBusy(true);
    setError("");
    try {
      let data: ProposalInput;
      if (remove && e) {
        data = {
          kind: "calendar.delete",
          data: { eventId: e.id, calendarId: e.calendarId, title: e.title },
        };
      } else {
        const parsed = eventDraftSchema.safeParse({
          calendarId: e?.calendarId || draft?.calendarId || "primary",
          title,
          start,
          end,
          allDay,
          timeZone: zone,
          location,
          description,
          attendees: attendees
            .split(/[,;\n]/)
            .map((a) => a.trim())
            .filter(Boolean),
        });
        if (!parsed.success)
          throw new Error(
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
          );
        data = e
          ? { kind: "calendar.update", data: { ...parsed.data, eventId: e.id } }
          : { kind: "calendar.create", data: parsed.data };
      }
      const action = await api.request<ActionProposal>("/api/actions", data);
      await refresh();
      open({ type: "review", action });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={e ? t("event.editTitle") : t("event.newTitle")}
      subtitle={e ? t("event.editSubtitle") : t("event.newSubtitle")}
      onClose={close}
    >
      <Field
        label={t("event.title")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("event.titlePlaceholder")}
      />
      <CheckRow
        label={t("event.allDay")}
        checked={allDay}
        onPress={() => {
          try {
            if (!allDay) {
              const local = localDateTime(start, zone);
              const endDay = new Date(`${local.date}T12:00:00Z`);
              endDay.setUTCDate(endDay.getUTCDate() + 1);
              setStart(local.date);
              setEnd(endDay.toISOString().slice(0, 10));
            } else {
              setStart(zonedInstant(start, "09:00", zone));
              setEnd(zonedInstant(start, "10:00", zone));
            }
            setAllDay(!allDay);
            setError("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      />
      <DateTimeEditor
        label={t("event.starts")}
        value={start}
        onChange={setStart}
        timeZone={zone}
        allDay={allDay}
      />
      <DateTimeEditor
        label={t("event.ends")}
        value={end}
        onChange={setEnd}
        timeZone={zone}
        allDay={allDay}
      />
      {allDay && <TText style={[s.small, { marginBottom: 15 }]}>{t("event.allDayNote")}</TText>}
      <Field
        label={t("event.timeZone")}
        value={zone}
        onChangeText={setZone}
        placeholder="America/Los_Angeles"
      />
      <Field
        label={t("event.location")}
        value={location}
        onChangeText={setLocation}
        placeholder={t("mail.optional")}
      />
      <Field
        label={t("event.attendees")}
        value={attendees}
        onChangeText={setAttendees}
        placeholder={t("event.attendeesPlaceholder")}
      />
      <Field
        label={t("event.notes")}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder={t("event.notesPlaceholder")}
      />
      {!!conflicts.length && (
        <Card style={{ backgroundColor: colors.orange, padding: 16, marginBottom: 16 }}>
          <TText style={s.heading}>{t("event.conflictTitle")}</TText>
          {conflicts.map((c) => (
            <TText key={c.id} style={s.muted}>
              {c.title} · {timeLabel(c.start, c.timeZone)}–{timeLabel(c.end, c.timeZone)}
            </TText>
          ))}
        </Card>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button primary icon={ShieldCheck} busy={busy} onPress={() => void propose()}>
          {e ? t("event.reviewChanges") : t("event.reviewEvent")}
        </Button>
        {e && (
          <Button icon={Trash2} disabled={busy} danger onPress={() => void propose(true)}>
            {t("event.reviewDeletion")}
          </Button>
        )}
      </View>
    </Sheet>
  );
}
function ReviewDetail({ initial }: { initial: ActionProposal }) {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, close, open } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action =
    local.status !== initial.status ? local : w.actions.find((a) => a.id === initial.id) || local;
  const d = action.data;
  const pending = action.status === "awaiting_review";
  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<ActionProposal>(`/api/actions/${action.id}/decide`, {
        decision,
        hash: action.hash,
      });
      setLocal(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    setBusy(true);
    setError("");
    try {
      let next: Detail;
      if (action.kind === "email.send")
        next = { type: "email", draft: emailDraftSchema.parse(action.data) };
      else {
        const draft = eventDraftSchema.parse(action.data);
        if (action.kind === "calendar.update") {
          const eventId = action.data.eventId;
          if (typeof eventId !== "string" || !eventId) throw new Error(t("event.refMissing"));
          next = { type: "event", event: { ...draft, id: eventId } };
        } else next = { type: "event", draft };
      }
      await api.request(`/api/actions/${action.id}/decide`, {
        decision: "deny",
        hash: action.hash,
      });
      await refresh();
      open(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const email = action.kind === "email.send";
  return (
    <Sheet
      title={pending ? t("review.lastLook") : action.title}
      subtitle={w.mode === "sample" ? t("review.localOnly") : t("review.reviewExact")}
      onClose={close}
    >
      <View style={[s.row, { gap: 13, marginBottom: 21 }]}>
        <View style={[s.iconBox, { backgroundColor: colors.lavender }]}>
          <ShieldCheck size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <TText style={s.heading}>{action.title}</TText>
          <TText style={s.small}>{action.kind.replace(".", " · ")}</TText>
        </View>
        <Chip tint={pending ? colors.lavender : colors.green}>
          {t(`review.status.${action.status}` as StringKey)}
        </Chip>
      </View>
      <Card style={{ gap: 13 }}>
        <ReviewLine label={t("review.account")} value={action.account || w.profile.email} />
        {email ? (
          <>
            <ReviewLine label={t("mail.to")} value={arrayText(d.to)} />
            <ReviewLine label={t("mail.cc")} value={arrayText(d.cc) || t("review.none")} />
            <ReviewLine label={t("mail.bcc")} value={arrayText(d.bcc) || t("review.none")} />
            <ReviewLine label={t("mail.subject")} value={String(d.subject || "")} />
            <View style={s.divider} />
            <TText selectable style={[s.text, { lineHeight: 25 }]}>
              {String(d.body || "")}
            </TText>
            <View style={s.divider} />
            <TText style={s.label}>{t("mail.attachments")}</TText>
            {Array.isArray(d.attachmentIds) && d.attachmentIds.length ? (
              d.attachmentIds.map((id) => {
                const file = w.files.find((f) => f.id === id);
                return (
                  <TText key={String(id)} style={s.text}>
                    {file?.name || String(id)} · {t("review.version", { v: String(id).slice(-8) })}
                  </TText>
                );
              })
            ) : (
              <TText style={s.muted}>{t("review.noAttachments")}</TText>
            )}
          </>
        ) : (
          <>
            <ReviewLine label={t("review.event")} value={String(d.title || "")} />
            {action.kind !== "calendar.delete" && (
              <>
                <ReviewLine
                  label={t("event.starts")}
                  value={
                    d.allDay
                      ? String(d.start || "")
                      : `${dateLabel(String(d.start || ""), { year: "numeric", month: "short", day: "numeric", timeZone: String(d.timeZone || "UTC") })} · ${timeLabel(String(d.start || ""), String(d.timeZone || "UTC"))}`
                  }
                />
                <ReviewLine
                  label={t("event.ends")}
                  value={
                    d.allDay
                      ? `${String(d.end || "")} ${t("event.exclusive")}`
                      : `${dateLabel(String(d.end || ""), { year: "numeric", month: "short", day: "numeric", timeZone: String(d.timeZone || "UTC") })} · ${timeLabel(String(d.end || ""), String(d.timeZone || "UTC"))}`
                  }
                />
                <ReviewLine label={t("event.timeZone")} value={String(d.timeZone || "")} />
                <ReviewLine
                  label={t("review.allDay")}
                  value={d.allDay ? t("review.yes") : t("review.no")}
                />
                <ReviewLine
                  label={t("review.location")}
                  value={String(d.location || t("review.none"))}
                />
                <ReviewLine
                  label={t("event.attendees")}
                  value={arrayText(d.attendees) || t("review.justYou")}
                />
                <ReviewLine
                  label={t("event.notes")}
                  value={String(d.description || t("review.none"))}
                />
              </>
            )}
            <ReviewLine label={t("review.calendar")} value={String(d.calendarId || "primary")} />
            <TText style={s.small}>
              {action.kind === "calendar.delete"
                ? t("review.deleteWarning")
                : t("review.updateWarning")}
            </TText>
          </>
        )}
      </Card>
      <ErrorNotice error={error || action.error} />
      {!!action.result && (
        <Card style={{ marginTop: 16, backgroundColor: colors.green, padding: 18 }}>
          <TText selectable style={s.text}>
            {resultSummary(action.result)}
          </TText>
        </Card>
      )}
      {pending ? (
        <>
          <TText style={[s.small, { marginVertical: 17 }]}>
            {t("review.expiryNote", {
              date: new Date(action.expiresAt).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              }),
            })}
          </TText>
          <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button primary icon={Check} busy={busy} onPress={() => void decide("approve")}>
              {w.mode === "sample"
                ? t("review.approveLocally")
                : email
                  ? t("review.approveSend")
                  : t("review.approveChange")}
            </Button>
            {action.kind !== "calendar.delete" && (
              <Button icon={Edit3} disabled={busy} onPress={() => void edit()}>
                {t("review.editDetails")}
              </Button>
            )}
            <Button icon={X} disabled={busy} onPress={() => void decide("deny")}>
              {t("review.dontProceed")}
            </Button>
          </View>
        </>
      ) : (
        <Button style={{ alignSelf: "flex-start", marginTop: 19 }} onPress={close}>
          {t("common.done")}
        </Button>
      )}
    </Sheet>
  );
}
function arrayText(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}
function ReviewLine({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return (
    <View style={{ gap: 4 }}>
      <TText style={s.label}>{label}</TText>
      <TText selectable style={s.text}>
        {value}
      </TText>
    </View>
  );
}
function FileDetail({ file: f }: { file: Artifact }) {
  const s = useStyles();
  const { api, refresh, open, close } = useWorkspace();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      (f.fields || [])
        .filter((field) => field.type !== "unsupported")
        .map((field) => [
          field.name,
          field.type === "checkbox" ? field.value === "true" || field.value === "Yes" : field.value,
        ]),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = api.url(f.url || `/api/files/${f.id}/content`);
  async function fill() {
    setBusy(true);
    setError("");
    try {
      const file = await api.request<Artifact>(`/api/files/${f.id}/fill`, { fields: values });
      await refresh();
      open({ type: "file", file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    setError("");
    try {
      if (Platform.OS === "web") {
        await Linking.openURL(url);
        return;
      }
      const target = `${FileSystem.cacheDirectory}${f.id}.pdf`;
      await FileSystem.downloadAsync(url, target, {
        headers: { Authorization: `Bearer ${api.token}` },
      });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(target, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      else throw new Error(t("file.shareUnavailable"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Sheet
      title={f.name}
      subtitle={t("file.sizeDetail", {
        pages: f.pageCount,
        kb: Math.max(1, Math.round(f.size / 1024)),
        source: f.source,
      })}
      onClose={close}
      wide
    >
      <PdfReader url={url} token={api.token} pageCount={f.pageCount} />
      <View style={[s.row, { gap: 10, marginVertical: 18, flexWrap: "wrap" }]}>
        <Button icon={Download} onPress={() => void share()}>
          {Platform.OS === "web" ? t("file.openDownload") : t("file.saveOrShare")}
        </Button>
        <Button
          icon={Send}
          onPress={() => open({ type: "email", draft: { attachmentIds: [f.id] } })}
        >
          {t("file.attachToEmail")}
        </Button>
      </View>
      {f.fields && f.fields.length > 0 && (
        <Card>
          <SectionHeading title={t("file.fillForm")} />
          <TText style={[s.muted, { marginBottom: 18 }]}>{t("file.fillNote")}</TText>
          {f.fields.map((field) =>
            field.type === "unsupported" ? (
              <TText key={field.name} style={s.muted}>
                {t("file.unsupportedField", { name: field.name })}
              </TText>
            ) : field.type === "checkbox" ? (
              <CheckRow
                key={field.name}
                checked={!!values[field.name]}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                onPress={() => setValues({ ...values, [field.name]: !values[field.name] })}
              />
            ) : (
              <Field
                key={field.name}
                label={field.name.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase())}
                value={String(values[field.name] || "")}
                onChangeText={(value) => setValues({ ...values, [field.name]: value })}
              />
            ),
          )}
          <Button primary icon={Save} busy={busy} onPress={() => void fill()}>
            {t("file.saveFilled")}
          </Button>
        </Card>
      )}
      <ErrorNotice error={error} />
      <TText style={[s.small, { marginTop: 15 }]}>
        {t("file.addedOn", { date: dateLabel(f.createdAt) })}
        {f.parentId ? t("file.filledCopy") : ""}
      </TText>
    </Sheet>
  );
}
function BrowserDetail({ initial }: { initial: BrowserSession }) {
  const colors = useColors();
  const s = useStyles();
  const { workspace: w, api, refresh, close, notify } = useWorkspace();
  const [local, setLocal] = useState(initial);
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const latest = w.browsers.find((b) => b.id === initial.id);
  const browser = {
    ...(latest && latest.updatedAt > local.updatedAt ? latest : local),
    consoleUrl: local.consoleUrl,
    previewUrl: local.previewUrl,
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<BrowserSession>(`/api/browsers/${initial.id}`)
      .then((session) => {
        if (active) {
          setLocal(session);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id, retry]);
  async function importDownloads() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{
        files: Artifact[];
        failures: { name: string; message: string }[];
      }>(`/api/browsers/${browser.id}/import-downloads`, {});
      await refresh();
      if (result.failures.length)
        setError(
          result.failures.map((failure) => `${failure.name}: ${failure.message}`).join("\n"),
        );
      const files = result.files;
      notify(
        files.length ? t("browser.pdfsAdded", { count: files.length }) : t("browser.noNewPdfs"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(end = false) {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<BrowserSession>(
        `/api/browsers/${browser.id}/${end ? "close" : browser.status === "closed" ? "reopen" : "navigate"}`,
        end ? {} : { url: browserAddress(url) },
      );
      setLocal(result);
      setUrl(result.url);
      await refresh();
      if (end) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={browserSite(browser.url)}
      subtitle={t("browser.statusLine", {
        status: t(`browser.status.${browser.status}` as StringKey),
        time: timeLabel(browser.updatedAt),
      })}
      onClose={close}
      wide
    >
      <View style={[s.row, { gap: 10, marginBottom: 16 }]}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("browser.addressLabel")}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
            onSubmitEditing={() => void mutate()}
          />
        </View>
        <Button primary busy={busy} disabled={loading || !url.trim()} onPress={() => void mutate()}>
          {browser.status === "closed"
            ? t("browser.reopenShort")
            : browser.status === "error"
              ? t("browser.reconnectShort")
              : t("browser.go")}
        </Button>
      </View>
      <ErrorNotice error={error} />
      {loading ? (
        <View style={[s.row, { gap: 10, paddingVertical: 24 }]}>
          {error ? (
            <Button onPress={() => setRetry(retry + 1)}>{t("browser.reconnectShort")}</Button>
          ) : (
            <>
              <ActivityIndicator color={colors.blueDark} />
              <TText style={s.muted}>{t("browser.connectingBrowser")}</TText>
            </>
          )}
        </View>
      ) : browser.status === "active" && browser.consoleUrl ? (
        <BrowserConsole url={api.url(browser.consoleUrl)} />
      ) : browser.status === "active" && browser.previewUrl ? (
        <Image
          source={{ uri: api.url(browser.previewUrl) }}
          style={{ width: "100%", height: 450, backgroundColor: colors.canvas }}
          resizeMode="contain"
        />
      ) : (
        <Empty
          icon={Globe2}
          title={browser.status === "closed" ? t("browser.sessionClosed") : t("browser.noPreview")}
          detail={
            browser.status === "closed" ? t("browser.profileSaved") : t("browser.reconnectProfile")
          }
        />
      )}
      <View style={[s.row, { gap: 10, marginTop: 18, flexWrap: "wrap" }]}>
        {!loading && browser.status === "active" && browser.consoleUrl && (
          <Button
            icon={ExternalLink}
            onPress={() => void Linking.openURL(api.url(browser.consoleUrl || ""))}
          >
            {t("browser.openInWindow")}
          </Button>
        )}
        {!loading && (
          <Button icon={RotateCw} disabled={busy} onPress={() => setRetry(retry + 1)}>
            {t("browser.refreshConnection")}
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={Download} busy={busy} onPress={() => void importDownloads()}>
            {t("browser.importPdfs")}
          </Button>
        )}
        {!loading && browser.status !== "closed" && (
          <Button icon={X} danger busy={busy} onPress={() => void mutate(true)}>
            {t("browser.closeSession")}
          </Button>
        )}
      </View>
    </Sheet>
  );
}
