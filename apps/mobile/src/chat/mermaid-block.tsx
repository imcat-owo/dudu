/**
 * MermaidBlock — renders ```mermaid fenced code blocks as diagrams (A21).
 *
 * Learned from Kelivo's real implementation
 * (lib/shared/widgets/mermaid_bridge.dart, _MermaidInlineWebView):
 * a WebView with mermaid.min.js inlined (bundled, works offline), the
 * diagram code HTML-escaped into `<div class="mermaid">`,
 * `mermaid.initialize({ startOnLoad: false, ... })` + `mermaid.run()`,
 * and the page posts its rendered height back so the native view sizes
 * itself. Dark/light follows the resolved theme mode.
 *
 * Failure is honest: a syntax error or WebView failure falls back to the
 * plain code block — never a blank box, never a spinner forever.
 */
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { useTheme } from "../theme/ThemeContext";
import { useColors } from "../ui";
import MERMAID_JS from "./mermaid-bundle";

function escapeHtml(code: string): string {
  return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(code: string, dark: boolean): string {
  const bg = dark ? "#1c1c1e" : "#f7f5f0";
  const fg = dark ? "#ececec" : "#2b2b2b";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
html,body{margin:0;padding:0;background:${bg};color:${fg};}
.wrap{padding:16px;box-sizing:border-box;}
.mermaid{width:100%;text-align:center;}
.mermaid svg{max-width:100%;height:auto;}
.err{font-family:monospace;font-size:12px;color:${fg};white-space:pre-wrap;}
</style>
</head>
<body>
<div class="wrap"><div class="mermaid">${escapeHtml(code)}</div></div>
<script>${MERMAID_JS}</script>
<script>
(function(){
  function postHeight(){
    try{
      var el=document.querySelector('.mermaid');
      if(!el) return;
      var h=Math.ceil(el.getBoundingClientRect().height)+32;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'height',value:h}));
    }catch(e){}
  }
  function postError(msg){
    try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',value:String(msg||'render failed')}));}catch(e){}
  }
  try{
    if(!window.mermaid){postError('mermaid failed to load');return;}
    window.mermaid.initialize({startOnLoad:false,theme:${dark ? "'dark'" : "'default'"},securityLevel:'loose'});
    window.mermaid.run({querySelector:'.mermaid'}).then(function(){
      var el=document.querySelector('.mermaid');
      if(el&&(el.querySelector('.error-icon,.error-text')||/syntax error/i.test(el.textContent||''))){postError('syntax error');return;}
      postHeight();
    }).catch(function(e){postError(e&&e.message||e);});
    setTimeout(postHeight,400);
  }catch(e){postError(e&&e.message||e);}
})();
</script>
</body>
</html>`;
}

export function MermaidBlock({ code }: { code: string }) {
  const colors = useColors();
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  const [height, setHeight] = useState(180);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const html = useMemo(() => buildHtml(code, dark), [code, dark]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type?: string; value?: unknown };
      if (msg.type === "height" && typeof msg.value === "number" && Number.isFinite(msg.value)) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setHeight(Math.max(120, Math.min(1200, Math.ceil(msg.value))));
      } else if (msg.type === "error") {
        setFailed(true);
      }
    } catch {
      // ignore malformed messages
    }
  };

  // Watchdog: if nothing renders in 12s, fall back to code honestly.
  const armWatchdog = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFailed((f) => (height <= 180 ? true : f)), 12000);
  };

  if (failed || showCode) {
    return (
      <View
        style={{
          backgroundColor: colors.line,
          borderRadius: radii.md,
          padding: 10,
          marginVertical: 4,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.mermaidShowDiagram")}
          onPress={() => {
            setFailed(false);
            setShowCode(false);
          }}
          style={{ alignSelf: "flex-end", padding: 4 }}
        >
          <TText style={{ fontSize: 11, color: colors.blueDark }}>
            {t("chat.mermaidShowDiagram")}
          </TText>
        </Pressable>
        <TText selectable style={{ fontSize: 12, color: colors.text }}>
          {code.replace(/\n$/, "")}
        </TText>
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: dark ? "#1c1c1e" : "#f7f5f0",
        borderRadius: radii.md,
        marginVertical: 4,
        overflow: "hidden",
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.mermaidShowCode")}
          onPress={() => setShowCode(true)}
          style={{ paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <TText style={{ fontSize: 11, color: colors.muted }}>{t("chat.mermaidShowCode")}</TText>
        </Pressable>
      </View>
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ height, backgroundColor: "transparent" }}
        scrollEnabled={false}
        onMessage={onMessage}
        onLoadEnd={armWatchdog}
        onError={() => setFailed(true)}
        javaScriptEnabled
        domStorageEnabled={false}
      />
    </View>
  );
}
