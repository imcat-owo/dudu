import {
  FileText,
  FolderOpen,
  Globe2,
  Monitor,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { browserAddress } from "./browser-address";
import { useComputerDraft } from "./computer-drafts";
import { LinuxWorkspace } from "./computer-workspace";
import { t } from "./i18n";
import { Button, Card, ErrorNotice, Field, LinkRow, Sheet, useColors, useStyles } from "./ui";
import { useWorkspace } from "./workspace";
import { TText } from "./font";

export function ComputerEntry() {
  const colors = useColors();
  const s = useStyles();
  const { workspace, open } = useWorkspace();
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const active = workspace.browsers.filter((b) => b.status === "active").length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("a11y.computerEntry")}
      onPress={() => open({ type: "computer" })}
      style={[
        s.row,
        {
          alignSelf: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 20,
          backgroundColor: colors.line,
        },
      ]}
    >
      <Monitor size={13} color={colors.muted} />
      <TText style={{ fontSize: 12, color: colors.muted }}>
        {t("computer.entry")}
        {!available
          ? t("computer.offline")
          : active
            ? t("computer.takeControlShort")
            : t("computer.ready")}
      </TText>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: available ? "#57AD85" : "#ACB0B5",
        }}
      />
    </Pressable>
  );
}
export function BrowserThreadCard({ browser }: { browser: BrowserSession }) {
  const colors = useColors();
  const s = useStyles();
  const { open } = useWorkspace();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [browser.previewUrl, browser.updatedAt]);
  return (
    <Card
      style={{ padding: 13, backgroundColor: colors.line, gap: 12, maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 9 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1 }}>
          <TText style={[s.text, { fontWeight: "600" }]}>{t("computer.tab.browser")}</TText>
          <TText numberOfLines={1} style={s.small}>
            {browser.status === "closed"
              ? t("browser.sessionSaved")
              : browser.status === "error"
                ? t("browser.needsAttention")
                : browser.title}
          </TText>
        </View>
      </View>
      {browser.previewUrl && browser.status === "active" && !failed ? (
        <Image
          accessibilityLabel={t("a11y.browserPreview", { title: browser.title })}
          source={{ uri: browser.previewUrl }}
          style={{
            width: "100%",
            aspectRatio: 1.6,
            borderRadius: 11,
            backgroundColor: colors.card,
          }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: colors.card,
            alignItems: "center",
            gap: 10,
          }}
        >
          <Globe2 size={30} color={colors.muted} />
          <TText numberOfLines={2} style={[s.muted, { textAlign: "center" }]}>
            {failed ? t("browser.previewUnavailable") : browser.url}
          </TText>
        </View>
      )}
      <Button onPress={() => open({ type: "browser", browser })}>
        {browser.status === "closed"
          ? t("browser.reopen")
          : browser.status === "error"
            ? t("browser.reconnect")
            : t("browser.takeControl")}
      </Button>
    </Card>
  );
}
export function ComputerSheet() {
  const colors = useColors();
  const s = useStyles();
  const { workspace, api, refresh, close, open, navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useComputerDraft("tab");
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void refresh().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", {
        url: browserAddress(url),
      });
      await refresh();
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("computer.sheetTitle")} subtitle={t("computer.sheetSubtitle")} onClose={close}>
      <View style={{ gap: 20 }}>
        {tab === "Browser" && (
          <View
            style={[s.row, { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.sky }]}
          >
            <Monitor size={28} color={colors.blueDark} />
            <View style={{ flex: 1 }}>
              <TText style={s.heading}>
                {available ? t("computer.browserConnected") : t("computer.browserOffline")}
              </TText>
              <TText style={s.muted}>
                {available ? t("computer.browserConnectedDesc") : t("computer.browserOfflineDesc")}
              </TText>
            </View>
          </View>
        )}
        <View style={[s.row, { gap: 8 }]}>
          {(["Browser", "Terminal", "Files"] as const).map((item) => (
            <Button
              key={item}
              primary={tab === item}
              icon={item === "Browser" ? Globe2 : item === "Terminal" ? Terminal : FolderOpen}
              onPress={() => setTab(item)}
            >
              {item === "Browser"
                ? t("computer.tab.browser")
                : item === "Terminal"
                  ? t("computer.tab.terminal")
                  : t("computer.tab.files")}
            </Button>
          ))}
        </View>
        <View style={{ display: tab === "Browser" ? "none" : "flex" }}>
          <LinuxWorkspace tab={tab === "Files" ? "Files" : "Terminal"} />
        </View>
        <ErrorNotice error={error} />
        {tab === "Browser" ? (
          <>
            <View>
              <Field
                label={t("browser.addressLabel")}
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                autoCapitalize="none"
                keyboardType="url"
                onSubmitEditing={() => void create()}
              />
              <Button
                primary
                icon={Plus}
                busy={busy}
                disabled={!available || !url.trim()}
                onPress={() => void create()}
              >
                {t("browser.openSession")}
              </Button>
            </View>
            {[...workspace.browsers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((browser) => (
                <BrowserThreadCard key={browser.id} browser={browser} />
              ))}
            {!workspace.browsers.length && <TText style={s.muted}>{t("browser.emptyHint")}</TText>}
            <TText style={s.small}>{t("browser.takeoverHint")}</TText>
          </>
        ) : tab === "Files" ? (
          <>
            <TText style={s.heading}>{t("computer.filesHeading")}</TText>
            <TText style={s.small}>{t("computer.filesDesc")}</TText>
            {workspace.files.map((file) => (
              <LinkRow
                key={file.id}
                icon={FileText}
                title={file.name}
                detail={t("computer.fileDetail", { count: file.pageCount })}
                onPress={() => open({ type: "file", file })}
              />
            ))}
            <Button
              icon={Plus}
              onPress={() => {
                close();
                navigate("files");
              }}
            >
              {t("computer.importDoc")}
            </Button>
          </>
        ) : null}
        <Button
          small
          icon={RefreshCw}
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(String(e)))
          }
        >
          {t("computer.refresh")}
        </Button>
      </View>
    </Sheet>
  );
}
