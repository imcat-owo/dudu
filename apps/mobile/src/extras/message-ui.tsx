/**
 * Batch 7 — message-row extras.
 *
 * - UserMessageBody: I13 collapsible long user messages + I14 optional
 *   markdown rendering for user text.
 * - AssistantMessageBody: I14 gate for assistant markdown (falls back to
 *   plain text when the pref is off).
 * - ThinkingBody: I14 gate for reasoning markdown in the thinking drawer.
 * - MessageMetaRow: I11 optional "model · time" row under a bubble, from
 *   the observed per-message metadata (never guessed).
 */

import { useState } from "react";
import { Pressable, View } from "react-native";
import Markdown from "react-native-markdown-renderer";
import { assistantMarkdown } from "../assistant-markdown";
import { TText } from "../font";
import { t } from "../i18n";
import { useColors } from "../ui";
import { useMessageMeta } from "./message-meta";
import { getExtrasPrefs, useExtrasPrefs } from "./prefs";

function mdStyles(fg: string) {
  return {
    text: { color: fg, fontSize: 15, lineHeight: 22 },
    paragraph: { color: fg, fontSize: 15, lineHeight: 22, marginTop: 0, marginBottom: 8 },
  };
}

/** I13: fold long user messages; I14: optional user markdown. */
export function UserMessageBody({ text, color }: { text: string; color: string }) {
  const { prefs } = useExtrasPrefs();
  const [expanded, setExpanded] = useState(false);
  const colors = useColors();
  const shouldFold = prefs.collapseLongUserMessages && text.length > prefs.collapseThresholdChars;
  const shown = shouldFold && !expanded ? `${text.slice(0, prefs.collapseThresholdChars)}…` : text;
  const body = prefs.markdownUser ? (
    <Markdown markdownit={assistantMarkdown} style={mdStyles(color) as never}>
      {shown}
    </Markdown>
  ) : (
    <TText style={{ color, fontSize: 15, lineHeight: 22 }}>{shown}</TText>
  );
  if (!shouldFold) return <>{body}</>;
  return (
    <View style={{ gap: 4 }}>
      {body}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? t("extras.collapse.fold") : t("extras.collapse.expand")}
        onPress={() => setExpanded(!expanded)}
        hitSlop={8}
      >
        <TText style={{ color: colors.blueDark, fontSize: 13 }}>
          {expanded ? t("extras.collapse.fold") : t("extras.collapse.expand")}
        </TText>
      </Pressable>
    </View>
  );
}

/** I14: assistant markdown gate. */
export function AssistantMessageBody({
  text,
  renderMarkdown,
}: {
  text: string;
  renderMarkdown: (content: string) => React.ReactNode;
}) {
  const { prefs } = useExtrasPrefs();
  if (!prefs.markdownAssistant) {
    return <TText style={{ fontSize: 15, lineHeight: 22 }}>{text}</TText>;
  }
  return <>{renderMarkdown(text)}</>;
}

/** I14: reasoning markdown gate for the thinking drawer. */
export function ThinkingBody({ text }: { text: string }) {
  const colors = useColors();
  const markdown = getExtrasPrefs().markdownReasoning;
  if (!markdown) {
    return <TText style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{text}</TText>;
  }
  return (
    <Markdown markdownit={assistantMarkdown} style={mdStyles(colors.text) as never}>
      {text}
    </Markdown>
  );
}

function formatTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** I11: optional "model · time" row under a message bubble. */
export function MessageMetaRow({ messageId, user }: { messageId: string; user: boolean }) {
  const { prefs } = useExtrasPrefs();
  const meta = useMessageMeta(messageId);
  const colors = useColors();
  if (!meta) return null;
  const parts: string[] = [];
  if (prefs.showModelName && !user && meta.model) parts.push(meta.model);
  if (prefs.showTimestamp) parts.push(formatTime(meta.at));
  if (!parts.length) return null;
  const avatarOffset = prefs.showAvatars ? 40 : 0;
  return (
    <TText
      style={{
        fontSize: 11,
        color: colors.muted,
        textAlign: user ? "right" : "left",
        marginLeft: user ? 0 : avatarOffset,
        marginRight: user ? avatarOffset : 0,
        marginTop: 2,
        maxWidth: "80%",
        alignSelf: user ? "flex-end" : "flex-start",
      }}
    >
      {parts.join(" · ")}
    </TText>
  );
}
