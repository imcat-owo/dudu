/**
 * Batch 7 I1 — translation UI.
 *
 * - TranslationCard: rendered under a message bubble; shows the streaming
 *   translation, the saved translation (with a clear button), or errors.
 * - TranslateLanguageSheet: target-language picker (Kelivo's language
 *   sheet equivalent).
 * - TranslatePage: standalone translate page (source → target), opened from
 *   settings. Uses the active API group; honest about needing one.
 */

import { Languages, X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import type { ApiGroup } from "../api-groups/types";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, Sheet, useColors, useStyles } from "../ui";
import { getExtrasPrefs, useExtrasPrefs } from "./prefs";
import {
  clearTranslation,
  type SavedTranslation,
  TRANSLATE_LANGS,
  translateLangLabel,
  translateMessage,
  translateText,
  useTranslation,
} from "./translate";

export function TranslateLanguageSheet({
  initial,
  onPick,
  onClose,
}: {
  initial: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Sheet title={t("extras.translate.pickLang")} onClose={onClose}>
      <View style={{ gap: 4 }}>
        {TRANSLATE_LANGS.map((l) => {
          const selected = l.code === initial;
          return (
            <Pressable
              key={l.code}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                onPick(l.code);
                onClose();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                paddingHorizontal: 4,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <TText style={{ flex: 1, fontSize: 16, color: colors.text }}>{l.label}</TText>
              {selected && <TText style={{ color: colors.blueDark }}>✓</TText>}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** Kick off translation for a message (call from the message menu). */
export function startMessageTranslation(
  messageId: string,
  text: string,
  group: ApiGroup | null,
  langCode?: string,
): void {
  void translateMessage(messageId, text, langCode ?? getExtrasPrefs().translateTargetLang, group);
}

export function TranslationCard({
  messageId,
  user,
  bubbleFg,
  bubbleBg,
}: {
  messageId: string;
  user: boolean;
  bubbleFg: string;
  bubbleBg: string;
}) {
  const { prefs } = useExtrasPrefs();
  const { saved, runningLang, partial, error } = useTranslation(messageId);
  if (!saved && runningLang === undefined && !error) return null;
  const shown: string | undefined = saved?.text ?? (partial || undefined);
  const avatarOffset = prefs.showAvatars ? 40 : 0;
  return (
    <View
      style={{
        maxWidth: "80%",
        alignSelf: user ? "flex-end" : "flex-start",
        marginLeft: user ? 0 : avatarOffset,
        marginRight: user ? avatarOffset : 0,
        marginTop: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: bubbleBg,
        opacity: 0.92,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Languages size={13} color={bubbleFg} />
        <TText style={{ fontSize: 12, color: bubbleFg, opacity: 0.8, flex: 1 }}>
          {saved
            ? t("extras.translate.translatedTo", { lang: translateLangLabel(saved.lang) })
            : runningLang
              ? t("extras.translate.translatingTo", { lang: translateLangLabel(runningLang) })
              : t("extras.translate.failed")}
        </TText>
        {runningLang !== undefined && <ActivityIndicator size="small" color={bubbleFg} />}
        {(saved || error) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("extras.translate.clear")}
            onPress={() => clearTranslation(messageId)}
            hitSlop={8}
          >
            <X size={14} color={bubbleFg} />
          </Pressable>
        )}
      </View>
      {error === "no-group" ? (
        <TText style={{ fontSize: 13, color: bubbleFg }}>{t("extras.translate.noGroup")}</TText>
      ) : error ? (
        <TText style={{ fontSize: 13, color: bubbleFg }}>
          {t("extras.translate.error", { error })}
        </TText>
      ) : shown ? (
        <TText style={{ fontSize: 14, color: bubbleFg, lineHeight: 20 }}>{shown}</TText>
      ) : null}
    </View>
  );
}

export function TranslatePage({ group }: { group: ApiGroup | null }) {
  const colors = useColors();
  const s = useStyles();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState(getExtrasPrefs().translateTargetLang);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const canGo = source.trim().length > 0 && !running && !!group;

  const go = () => {
    if (!canGo || !group) return;
    setRunning(true);
    setResult("");
    void translateText(source, target, group, (partial) => setResult(partial)).then((final) => {
      setRunning(false);
      setResult(final ?? t("extras.translate.failed"));
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <TextInput
          accessibilityLabel={t("extras.translate.sourceLabel")}
          value={source}
          onChangeText={setSource}
          placeholder={t("extras.translate.sourcePlaceholder")}
          placeholderTextColor={colors.muted}
          multiline
          style={{
            minHeight: 110,
            color: colors.text,
            fontSize: 16,
            textAlignVertical: "top",
          }}
        />
      </Card>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Button small icon={Languages} onPress={() => setLangOpen(true)}>
          {translateLangLabel(target)}
        </Button>
        <View style={{ flex: 1 }} />
        <Button small primary disabled={!canGo} onPress={go}>
          {t("extras.translate.go")}
        </Button>
      </View>
      {!group && <TText style={s.muted}>{t("extras.translate.noGroup")}</TText>}
      {(running || result) && (
        <Card style={{ gap: 6 }}>
          <TText style={[s.small, { color: colors.muted }]}>
            {translateLangLabel(target)}
            {running ? "…" : ""}
          </TText>
          {running && !result ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <TText style={{ fontSize: 16, lineHeight: 24, color: colors.text }}>{result}</TText>
          )}
        </Card>
      )}
      {langOpen && (
        <TranslateLanguageSheet
          initial={target}
          onPick={(code) => setTarget(code)}
          onClose={() => setLangOpen(false)}
        />
      )}
    </View>
  );
}

export type { SavedTranslation };
