import { Check, Globe2, Hand, RotateCw } from "lucide-react-native";
import { createContext, useContext, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, View } from "react-native";
import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src";
import { t } from "./i18n";
import { Button, Card, ErrorNotice, useColors, useStyles } from "./ui";
import { useWorkspace } from "./workspace";
import { TText } from "./font";
import { radii } from "./theme/radii";

export const BrowserRunContext = createContext({ running: false, active: false });

const observationSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  url: z.url(),
});

function resultValue(result: unknown) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function siteLabel(url: unknown) {
  if (typeof url !== "string") return t("browsercard.opening");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return t("browsercard.opening");
  }
}

/** A server tool result stays with the request that produced it, including on replay. */
export function BrowserToolCard({
  url,
  result,
  loading,
}: {
  url: unknown;
  result: unknown;
  loading: boolean;
}) {
  const colors = useColors();
  const s = useStyles();
  const { api, workspace, open } = useWorkspace();
  const { running, active } = useContext(BrowserRunContext);
  const working = loading && active;
  const value = resultValue(result);
  const observation = observationSchema.safeParse(value);
  const toolError = z.object({ error: z.string() }).safeParse(value);
  const sessionId = observation.success ? observation.data.sessionId : undefined;
  const current = workspace.browsers.find((browser) => browser.id === sessionId);
  const [browser, setBrowser] = useState<BrowserSession>();
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    async function connect() {
      setError("");
      setPreviewFailed(false);
      try {
        const session = await api.request<BrowserSession>(
          `/api/browsers/${encodeURIComponent(sessionId || "")}`,
        );
        if (active) setBrowser(session);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void connect();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void connect();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [api, sessionId, current?.updatedAt, retry]);

  const visited = observation.success ? observation.data : undefined;
  // A later turn can reuse the same browser. Never label that new page as an old source.
  const preview =
    browser?.status === "active" && browser.url === visited?.url && !previewFailed
      ? browser.previewUrl
      : undefined;
  const failure = toolError.success
    ? toolError.data.error
    : !loading && !visited
      ? t("browsercard.noPage")
      : "";
  return (
    <Card
      style={{ padding: 13, backgroundColor: colors.line, gap: 12, width: "100%", maxWidth: 440 }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: radii.sm }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <TText style={[s.text, { fontWeight: "600" }]}>浏览器</TText>
          <TText numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
            {working
              ? t("browsercard.reading")
              : loading
                ? t("browsercard.paused")
                : failure
                  ? t("browsercard.couldntRead")
                  : siteLabel(visited?.url)}
          </TText>
        </View>
        {working ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : visited ? (
          <Check size={17} color="#47896C" accessibilityLabel={t("browsercard.pageRead")} />
        ) : null}
      </View>
      {preview ? (
        <Image
          accessibilityLabel={t("browsercard.preview", { title: visited?.title ?? "" })}
          source={{ uri: api.url(preview) }}
          style={{
            width: "100%",
            aspectRatio: 1.7,
            borderRadius: radii.md,
            backgroundColor: colors.card,
          }}
          resizeMode="contain"
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <View style={{ backgroundColor: colors.card, borderRadius: radii.md, padding: 21, gap: 12 }}>
          <TText numberOfLines={2} style={[s.text, { fontSize: 14 }]}>
            {visited?.title || siteLabel(url)}
          </TText>
          {working ? (
            <View style={{ gap: 8 }}>
              {(["90%", "74%", "84%"] as const).map((width) => (
                <View
                  key={width}
                  style={{ height: 7, width, borderRadius: radii.xs, backgroundColor: colors.line }}
                />
              ))}
            </View>
          ) : visited ? (
            <TText style={s.small}>
              {browser && browser.url !== visited.url
                ? t("browsercard.visited")
                : browser?.status === "closed"
                  ? t("browsercard.sessionSaved")
                  : browser?.status === "error"
                    ? t("browsercard.needsAttention")
                    : previewFailed
                      ? t("browsercard.previewUnavailable")
                      : t("browsercard.connecting")}
            </TText>
          ) : null}
        </View>
      )}
      <ErrorNotice error={failure || error} />
      {!loading && visited && (
        <Button
          icon={Hand}
          disabled={!browser || running}
          onPress={() => browser && open({ type: "browser", browser })}
          style={{ backgroundColor: colors.card, minHeight: 38, paddingVertical: 8 }}
        >
          Take control
        </Button>
      )}
      {!!error && (
        <Button small icon={RotateCw} onPress={() => setRetry((attempt) => attempt + 1)}>
          Reconnect preview
        </Button>
      )}
    </Card>
  );
}
