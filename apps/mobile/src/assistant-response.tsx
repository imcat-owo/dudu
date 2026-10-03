import { useCallback, useMemo, useState } from "react";
import { Linking, Text, type TextStyle } from "react-native";
import Markdown, { type MarkdownStyles, type RenderRules } from "react-native-markdown-renderer";
import { useFontSizeSetting } from "./app-settings";
import { assistantMarkdown, isSafeAssistantUrl } from "./assistant-markdown";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";
import { ErrorNotice, useColors } from "./ui";

const renderCodeBlock: RenderRules["fence"] = (node, _children, _parent, styles) => (
  <Text key={node.key} selectable style={styles.codeBlock as TextStyle}>
    {node.content.replace(/\n$/, "")}
  </Text>
);

export function AssistantResponse({ content }: { content: string }) {
  const colors = useColors();
  const { tokens } = useTheme();
  const { scale } = useFontSizeSetting();
  const [linkError, setLinkError] = useState("");
  const onLinkPress = useCallback((url: string) => {
    if (!isSafeAssistantUrl(url)) return false;
    setLinkError("");
    void Linking.openURL(url).catch((error) =>
      setLinkError(error instanceof Error ? error.message : String(error)),
    );
    return false;
  }, []);

  const { mdStyle, mdRules } = useMemo(() => {
    // Compact base type (15pt, matching s.text) scaled by the font-size setting.
    const fs = (base: number): number => Math.round(base * scale * 10) / 10;
    const fg = tokens.aiBubble.fg;
    const textStyle = { color: fg, fontSize: fs(15), lineHeight: fs(22) };
    const mdStyle: Partial<MarkdownStyles> = {
      text: textStyle,
      paragraph: { marginTop: 0, marginBottom: 6 },
      list: { marginBottom: 6 },
      headingContainer: { marginTop: 8, marginBottom: 4 },
      heading1: { fontSize: fs(19), lineHeight: fs(25), color: fg },
      heading2: { fontSize: fs(17), lineHeight: fs(23), color: fg },
      heading3: { fontSize: fs(16), lineHeight: fs(22), color: fg },
      link: { color: colors.blueDark, textDecorationLine: "underline" },
      codeInline: { backgroundColor: colors.line, color: fg },
      codeBlock: { backgroundColor: colors.line, color: fg },
    };
    const mdRules: RenderRules = {
      textgroup: (node, children) => (
        <Text key={node.key} selectable style={textStyle}>
          {children}
        </Text>
      ),
      image: (node) => (
        <Text key={node.key} selectable style={{ color: colors.muted }}>
          {node.attributes.alt
            ? t("chat.imageAlt", { alt: node.attributes.alt })
            : t("chat.imageFallback")}
        </Text>
      ),
      code_block: renderCodeBlock,
      fence: renderCodeBlock,
    };
    return { mdStyle, mdRules };
  }, [colors, tokens, scale]);

  return (
    <>
      <Markdown
        markdownit={assistantMarkdown}
        style={mdStyle}
        rules={mdRules}
        onLinkPress={onLinkPress}
      >
        {content}
      </Markdown>
      <ErrorNotice error={linkError} />
    </>
  );
}
