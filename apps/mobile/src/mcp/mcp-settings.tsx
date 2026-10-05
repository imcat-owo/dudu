/**
 * MCP server management UI — D2.
 *
 * She adds her own MCP servers here: URL, transport (HTTP/SSE), optional
 * headers, OAuth, per-tool approval. No need to ask me.
 *
 * Secrets (tokens, client secrets) go to SecureStore via mcpStore —
 * never displayed, never logged.
 */

import { useState } from "react";
import { Pressable, Switch, View, TextInput, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, useColors } from "../ui";
import { mcpStore, useMcpServers } from "./store";
import { startAuthorization } from "./oauth";
import type { McpServerConfig, McpTransportType } from "./types";

export const MCP_OAUTH_REDIRECT = "dudu://oauth/mcp";

function newServer(): McpServerConfig {
  return {
    id: `mcp_${Date.now()}`,
    name: "",
    transport: "http",
    url: "",
    enabled: true,
  };
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <TText style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{label}</TText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          padding: 8,
          color: colors.text,
          backgroundColor: colors.canvas,
          minHeight: multiline ? 60 : undefined,
          textAlignVertical: multiline ? "top" : undefined,
        }}
      />
    </View>
  );
}

function ServerEditor({
  server,
  onSave,
  onCancel,
}: {
  server: McpServerConfig;
  onSave: (s: McpServerConfig) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<McpServerConfig>(server);
  const set = <K extends keyof McpServerConfig>(k: K, v: McpServerConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Card>
      <View style={{ gap: 12 }}>
        <LabeledInput
          label={t("mcp.name")}
          value={draft.name}
          onChange={(v) => set("name", v)}
          placeholder={t("mcp.namePlaceholder")}
        />
        <LabeledInput
          label={t("mcp.url")}
          value={draft.url}
          onChange={(v) => set("url", v)}
          placeholder="https://mcp.example.com/mcp"
        />
        <View style={{ gap: 4 }}>
          <TText style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
            {t("mcp.transport")}
          </TText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["http", "sse"] as McpTransportType[]).map((tp) => (
              <Pressable
                key={tp}
                onPress={() => set("transport", tp)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: draft.transport === tp ? colors.blue : colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <TText style={{ color: draft.transport === tp ? "#fff" : colors.text }}>
                  {tp === "http" ? "Streamable HTTP" : "SSE"}
                </TText>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ gap: 4 }}>
          <TText style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
            {t("mcp.headers")}
          </TText>
          <TText style={{ fontSize: 12, color: colors.muted }}>{t("mcp.headersHint")}</TText>
          <TextInput
            value={Object.entries(draft.headers ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
            onChangeText={(v) => {
              const headers: Record<string, string> = {};
              for (const line of v.split("\n")) {
                const idx = line.indexOf(":");
                if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
              }
              set("headers", headers);
            }}
            placeholder="X-API-Key: ${MY_KEY}"
            placeholderTextColor={colors.muted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 8,
              padding: 8,
              color: colors.text,
              backgroundColor: colors.canvas,
              minHeight: 60,
              textAlignVertical: "top",
            }}
          />
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <TText style={{ color: colors.text }}>{t("mcp.useOAuth")}</TText>
          <Switch value={!!draft.oauth} onValueChange={(v) => set("oauth", v ? {} : undefined)} />
        </View>
        {draft.oauth && (
          <LabeledInput
            label={t("mcp.oauthScopes")}
            value={(draft.oauth.scopes ?? []).join(" ")}
            onChange={(v) =>
              set("oauth", { ...draft.oauth, scopes: v.split(/\s+/).filter(Boolean) })
            }
            placeholder="openid profile"
          />
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            primary
            onPress={() => {
              if (!draft.name.trim() || !draft.url.trim()) return;
              onSave(draft);
            }}
          >
            {t("common.save")}
          </Button>
          <Button onPress={onCancel}>{t("common.cancel")}</Button>
        </View>
      </View>
    </Card>
  );
}

export default function McpSettings() {
  const { servers, loaded } = useMcpServers();
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [adding, setAdding] = useState(false);
  const [authorizing, setAuthorizing] = useState<string | null>(null);

  if (!loaded) return null;

  /** OAuth browser flow: open system browser → handle dudu://oauth/mcp redirect → save tokens. */
  async function authorizeServer(server: McpServerConfig) {
    if (!server.oauth) return;
    setAuthorizing(server.id);
    try {
      const flow = await startAuthorization(
        server.url,
        server.oauth,
        MCP_OAUTH_REDIRECT,
        "Dudu MCP",
      );
      const result = await WebBrowser.openAuthSessionAsync(
        flow.authorizationUrl,
        MCP_OAUTH_REDIRECT,
      );
      if (result.type !== "success") {
        // She cancelled — not an error.
        return;
      }
      const tokens = await flow.finish(result.url);
      await mcpStore.saveTokens(server.id, tokens);
      await mcpStore.saveClientCreds(server.id, {
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
      });
      Alert.alert(t("mcp.oauth.successTitle"), t("mcp.oauth.success", { name: server.name }));
    } catch (e) {
      Alert.alert(
        t("mcp.oauth.failedTitle"),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setAuthorizing(null);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <TText style={{ fontSize: 13, opacity: 0.7 }}>{t("mcp.intro")}</TText>

      {servers.map((s) => (
        <Card key={s.id}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <View style={{ flex: 1 }}>
              <TText style={{ fontWeight: "600" }}>{s.name || s.url}</TText>
              <TText style={{ fontSize: 12, opacity: 0.6 }}>
                {s.transport === "http" ? "Streamable HTTP" : "SSE"} · {s.url}
              </TText>
            </View>
            <Switch value={s.enabled} onValueChange={(v) => mcpStore.upsert({ ...s, enabled: v })} />
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button small onPress={() => setEditing(s)}>
              {t("common.edit")}
            </Button>
            {s.oauth && (
              <Button
                small
                primary
                disabled={authorizing === s.id}
                onPress={() => void authorizeServer(s)}
              >
                {authorizing === s.id ? t("mcp.oauth.authorizing") : t("mcp.oauth.authorize")}
              </Button>
            )}
            <Button small danger onPress={() => mcpStore.remove(s.id)}>
              {t("common.delete")}
            </Button>
          </View>
        </Card>
      ))}

      {adding ? (
        <ServerEditor
          server={newServer()}
          onSave={(s) => {
            mcpStore.upsert(s);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : editing ? (
        <ServerEditor
          server={editing}
          onSave={(s) => {
            mcpStore.upsert(s);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button primary onPress={() => setAdding(true)}>
          {t("mcp.addServer")}
        </Button>
      )}
    </View>
  );
}
