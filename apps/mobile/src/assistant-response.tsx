import { useCallback, useMemo, useState } from "react";
import { Linking, type TextStyle } from "react-native";
import Markdown, { type MarkdownStyles, type RenderRules } from "react-native-markdown-renderer";
import { assistantMarkdown, isSafeAssistantUrl } from "./assistant-markdown";
import { TText } from "./font";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";
import { ErrorNotice, useColors } from "./ui";

const renderCodeBlock: RenderRules["fence"] = (node, _children, _parent, styles) => (
  <TText key={node.key} selectable style={styles.codeBlock as TextStyle}>
    {node.content.replace(/\n$/, "")}
  </TText>
);

export function AssistantResponse({ content }: { content: string }) {
  const colors = useColors();
  const { tokens } = useTheme();
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
    // Compact base type (15pt, matching s.text). TText applies the user's
    // font-size setting at render time — do NOT pre-scale here.
    const fg = tokens.aiBubble.fg;
    const textStyle = { color: fg, fontSize: 15, lineHeight: 22 };
    const mdStyle: Partial<MarkdownStyles> = {
      text: textStyle,
      paragraph: { marginTop: 0, marginBottom: 6 },
      list: { marginBottom: 6 },
      headingContainer: { marginTop: 8, marginBottom: 4 },
      heading1: { fontSize: 19, lineHeight: 25, color: fg },
      heading2: { fontSize: 17, lineHeight: 23, color: fg },
      heading3: { fontSize: 16, lineHeight: 22, color: fg },
      link: { color: colors.blueDark, textDecorationLine: "underline" },
      codeInline: { backgroundColor: colors.line, color: fg },
      codeBlock: { backgroundColor: colors.line, color: fg },
    };
    const mdRules: RenderRules = {
      textgroup: (node, children) => (
        <TText key={node.key} selectable style={textStyle}>
          {children}
        </TText>
      ),
      image: (node) => (
        <TText key={node.key} selectable style={{ color: colors.muted }}>
          {node.attributes.alt
            ? t("chat.imageAlt", { alt: node.attributes.alt })
            : t("chat.imageFallback")}
        </TText>
      ),
      code_block: renderCodeBlock,
      fence: renderCodeBlock,
    };
    return { mdStyle, mdRules };
  }, [colors, tokens]);

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
