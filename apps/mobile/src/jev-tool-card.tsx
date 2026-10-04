import { Check, ExternalLink } from "lucide-react-native";
import { createContext, useContext, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import type { JevOption, JevPanel } from "../../../packages/domain/src/jev";
import { TText } from "./font";
import { t } from "./i18n";
import {
  choiceAvailability,
  parseJevResult,
  retryChoiceAvailable,
  selectionText,
} from "./jev-actions";
import { radii } from "./theme/radii";
import { Button, Card, ErrorNotice, useColors, useStyles } from "./ui";

type JevInteraction = {
  threadId: string | null;
  busy: boolean;
  latestPanelId: string | null;
  latestUserText: string | null;
  send: (text: string) => Promise<void>;
  retry: (text: string) => Promise<void>;
  canRetry: boolean;
  confirmedSelection: (panelId: string) => string | null;
};

export const JevInteractionContext = createContext<JevInteraction>({
  threadId: null,
  busy: true,
  latestPanelId: null,
  latestUserText: null,
  canRetry: false,
  confirmedSelection: () => null,
  send: async () => {
    throw new Error(t("jev.openConversation"));
  },
  retry: async () => {
    throw new Error(t("jev.openConversationRetry"));
  },
});

function SourceLink({ title, url }: { title: string; url: string }) {
  const colors = useColors();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("jev.source", { title })}
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [s.row, { gap: 4, opacity: pressed ? 0.65 : 1 }]}
    >
      <TText style={[s.small, { color: colors.blueDark, textDecorationLine: "underline" }]}>
        {title}
      </TText>
      <ExternalLink size={12} color={colors.blueDark} />
    </Pressable>
  );
}

function ChoiceButton({
  panel,
  option,
  disabled,
  pending,
  selected,
  position,
  onChoose,
}: {
  panel: JevPanel;
  option: JevOption;
  disabled: boolean;
  pending: boolean;
  selected: boolean;
  position: number;
  onChoose: (optionId: string) => void;
}) {
  const colors = useColors();
  const s = useStyles();
  if (panel.type === "comparison") {
    const caption = /exhibit/i.test(panel.title) ? t("jev.chooseExhibit") : t("jev.chooseOption");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("jev.chooseA11y", { caption, label: option.label, position })}
        accessibilityState={{ disabled: disabled || pending, busy: pending, selected }}
        disabled={disabled || pending}
        onPress={() => onChoose(option.id)}
        style={({ pressed }) => [
          s.button,
          { alignSelf: "flex-start", backgroundColor: colors.blue },
          (disabled || pending) && { opacity: 0.5 },
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
      >
        {pending ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : selected ? (
          <Check size={15} color={colors.text} />
        ) : null}
        <TText style={s.buttonText}>{caption}</TText>
      </Pressable>
    );
  }
  return (
    <Button
      small
      disabled={disabled}
      busy={pending}
      icon={selected ? Check : undefined}
      onPress={() => onChoose(option.id)}
    >
      {option.label}
    </Button>
  );
}

export function JevToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const colors = useColors();
  const s = useStyles();
  const interaction = useContext(JevInteractionContext);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [failedOptionId, setFailedOptionId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState("");
  const pendingRef = useRef(false);
  if (loading) {
    return (
      <View style={[s.row, { gap: 10, padding: 14 }]}>
        <ActivityIndicator size="small" color={colors.blueDark} />
        <TText style={s.muted}>{t("jev.preparing")}</TText>
      </View>
    );
  }

  const parsed = parseJevResult(result);
  if (!parsed) return <ErrorNotice error={t("jev.couldntDisplay")} />;
  if (parsed.error) return <ErrorNotice error={parsed.error} />;
  const panel = parsed.panel;
  if (!panel) return null;

  const availability = choiceAvailability(
    panel,
    interaction.threadId || "",
    interaction.latestPanelId,
    interaction.busy,
    submittingId !== null ||
      confirmedId !== null ||
      interaction.confirmedSelection(panel.id) !== null,
  );
  const stale = availability === "wrong-thread" || availability === "stale";
  const selectedId = panel.selectedId || confirmedId || interaction.confirmedSelection(panel.id);
  const preferredOption = panel.preferredId
    ? panel.options.find((option) => option.id === panel.preferredId)
    : undefined;
  const disabled = availability !== "ready";

  async function choose(optionId: string, retrying = false) {
    const priorConfirmedId =
      panel?.selectedId || confirmedId || (panel && interaction.confirmedSelection(panel.id));
    if (
      !panel ||
      pendingRef.current ||
      priorConfirmedId ||
      (retrying
        ? !retryChoiceAvailable(
            panel,
            interaction.threadId || "",
            interaction.latestPanelId,
            failedOptionId,
            interaction.latestUserText,
            !!priorConfirmedId,
            !interaction.canRetry,
          ) || optionId !== failedOptionId
        : choiceAvailability(
            panel,
            interaction.threadId || "",
            interaction.latestPanelId,
            interaction.busy,
            false,
          ) !== "ready")
    )
      return;
    pendingRef.current = true;
    setSubmittingId(optionId);
    setSubmitError("");
    try {
      await (retrying ? interaction.retry : interaction.send)(selectionText(panel, optionId));
      setConfirmedId(optionId);
      setFailedOptionId(null);
    } catch (error) {
      setFailedOptionId(optionId);
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingRef.current = false;
      setSubmittingId(null);
    }
  }

  return (
    <Card style={{ width: "100%", maxWidth: 440, padding: 17, gap: 13 }}>
      <View style={{ gap: 5 }}>
        <TText style={s.heading}>{panel.title}</TText>
        {panel.mode === "sample" && <TText style={s.small}>{t("jev.sampleDecision")}</TText>}
        {panel.mode === "live" && <TText style={s.small}>{t("jev.liveDecision")}</TText>}
        {preferredOption && !selectedId && (
          <TText style={s.small}>
            {t("jev.preferredOption", { label: preferredOption.label })}
          </TText>
        )}
        {stale && <TText style={s.small}>{t("jev.staleChoice")}</TText>}
        {selectedId && <TText style={s.small}>{t("jev.submitted")}</TText>}
      </View>
      {panel.type === "clarification" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {panel.options.map((option, index) => (
            <ChoiceButton
              key={option.id}
              panel={panel}
              option={option}
              disabled={disabled}
              pending={submittingId === option.id}
              selected={selectedId === option.id}
              position={index + 1}
              onChoose={(id) => void choose(id)}
            />
          ))}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {panel.options.map((option, index) => (
            <View
              key={option.id}
              style={{ borderRadius: radii.lg, padding: 14, gap: 9, backgroundColor: colors.line }}
            >
              <TText style={[s.text, { fontWeight: "600" }]}>{option.label}</TText>
              {!!option.details.length && (
                <TText style={s.muted}>
                  {option.details.map((detail) => `• ${detail}`).join("\n")}
                </TText>
              )}
              <View style={{ gap: 5 }}>
                {option.sources.map((source) => (
                  <SourceLink key={`${option.id}-${source.url}`} {...source} />
                ))}
              </View>
              <ChoiceButton
                panel={panel}
                option={option}
                disabled={disabled}
                pending={submittingId === option.id}
                selected={selectedId === option.id}
                position={index + 1}
                onChoose={(id) => void choose(id)}
              />
            </View>
          ))}
        </View>
      )}
      <ErrorNotice error={submitError} />
      {failedOptionId && !selectedId && (
        <Button
          small
          disabled={
            !retryChoiceAvailable(
              panel,
              interaction.threadId || "",
              interaction.latestPanelId,
              failedOptionId,
              interaction.latestUserText,
              false,
              !interaction.canRetry || submittingId !== null,
            )
          }
          onPress={() => void choose(failedOptionId, true)}
        >
          Retry choice
        </Button>
      )}
    </Card>
  );
}
