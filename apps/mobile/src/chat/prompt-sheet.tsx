import { useEffect, useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, useColors } from "../ui";

/**
 * D39: cross-platform text prompt. Alert.prompt is iOS-only — on Android/Web
 * it silently does nothing, which turned "edit & resend" and "rename dialog"
 * into dead buttons. This sheet works on every platform.
 */
export function PromptSheet({
  visible,
  title,
  initialValue,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialValue?: string;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [value, setValue] = useState(initialValue ?? "");
  useEffect(() => {
    if (visible) setValue(initialValue ?? "");
  }, [visible, initialValue]);
  if (!visible) return null;
  const submit = () => {
    onSubmit(value);
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          justifyContent: "center",
          padding: 28,
        }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.xl,
            padding: 16,
          }}
        >
          <TText
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: colors.text,
              marginBottom: 12,
            }}
          >
            {title}
          </TText>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            placeholderTextColor={colors.muted}
            style={{
              backgroundColor: colors.inputBg,
              borderRadius: radii.md,
              padding: 12,
              color: colors.text,
              fontSize: 15,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 14,
            }}
          >
            <Button small onPress={onClose}>
              {t("common.cancel")}
            </Button>
            <Button small primary onPress={submit}>
              {t("common.done")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
