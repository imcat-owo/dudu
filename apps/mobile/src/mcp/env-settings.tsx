/**
 * EnvVarsSection — environment variable management (D15).
 *
 * Lives in the API settings screen. The list shows NAMES ONLY — values
 * never leave SecureStore and are never rendered. Add / edit / delete all
 * go through envStore (SecureStore-backed). Companion metadata
 * (<NAME>__META) is filtered out of the list.
 */

import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, useColors, useStyles } from "../ui";
import { type EnvMeta, envStore, useEnvVarNames } from "./env";
import { ENV_META_SUFFIX } from "./env-form";

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View style={{ gap: 4 }}>
      <TText style={[s.small, { fontWeight: "600" }]}>{label}</TText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
    </View>
  );
}

function VarForm({
  initialName,
  onDone,
}: {
  /** When set, editing an existing variable (name locked). */
  initialName?: string;
  onDone: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [name, setName] = useState(initialName ?? "");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialName) return;
    let live = true;
    void envStore.getMeta(initialName).then((meta: EnvMeta | null) => {
      if (!live || !meta) return;
      setAccount(meta.account);
      setNote(meta.note);
      if (meta.url) setUrl(meta.url);
    });
    return () => {
      live = false;
    };
  }, [initialName]);

  const submit = async () => {
    const cleanName = (initialName ?? name).trim();
    if (!cleanName) {
      setError(t("env.form.nameRequired"));
      return;
    }
    if (!account.trim()) {
      setError(t("env.form.accountRequired"));
      return;
    }
    // New variables require a secret; editing keeps the old one when empty.
    if (!initialName && !secret) {
      setError(t("env.form.secretRequired"));
      return;
    }
    if (!note.trim()) {
      setError(t("env.form.noteRequired"));
      return;
    }
    setError(null);
    try {
      const normalized = cleanName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      if (secret) await envStore.set(normalized, secret);
      else if (!initialName) throw new Error("secret required");
      await envStore.set(
        normalized + ENV_META_SUFFIX,
        JSON.stringify({
          account: account.trim(),
          note: note.trim(),
          ...(url.trim() ? { url: url.trim() } : {}),
          updatedAt: Date.now(),
        }),
      );
      onDone();
    } catch {
      setError(t("env.settings.saveFailed"));
    }
  };

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: radii.sm,
        backgroundColor: colors.canvas,
      }}
    >
      {!initialName ? (
        <Field
          label={t("env.form.name")}
          value={name}
          onChange={setName}
          placeholder="TAVILY_API_KEY"
        />
      ) : (
        <TText style={{ fontWeight: "700" }}>{initialName}</TText>
      )}
      <Field
        label={t("env.form.account")}
        value={account}
        onChange={setAccount}
        placeholder={t("env.form.accountPh")}
      />
      <Field
        label={initialName ? t("env.settings.newSecret") : t("env.form.secret")}
        value={secret}
        onChange={setSecret}
        placeholder={initialName ? t("env.settings.newSecretPh") : t("env.form.secretPh")}
        secure
      />
      <Field
        label={t("env.form.note")}
        value={note}
        onChange={setNote}
        placeholder={t("env.form.notePh")}
      />
      <Field
        label={t("env.form.url")}
        value={url}
        onChange={setUrl}
        placeholder={t("env.form.urlPh")}
      />
      {error ? <TText style={[s.small, { color: colors.danger }]}>{error}</TText> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button small primary onPress={() => void submit()}>
            {t("common.save")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button small onPress={onDone}>
            {t("common.cancel")}
          </Button>
        </View>
      </View>
    </View>
  );
}

export function EnvVarsSection() {
  const colors = useColors();
  const s = useStyles();
  const { names, loaded } = useEnvVarNames();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Companion metadata entries are not variables — hide them.
  const vars = names.filter((n) => !n.endsWith(ENV_META_SUFFIX));

  const confirmDelete = (name: string) => {
    Alert.alert(t("env.settings.deleteTitle"), t("env.settings.deleteBody", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void envStore.remove(name),
      },
    ]);
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <TText style={[s.small, { fontWeight: "700" }]}>
          {t("env.settings.title")} ({vars.length})
        </TText>
        <Button small onPress={() => setAdding((v) => !v)}>
          {t("env.settings.add")}
        </Button>
      </View>
      <TText style={[s.small, { color: colors.muted }]}>{t("env.settings.hint")}</TText>
      {adding ? <VarForm onDone={() => setAdding(false)} /> : null}
      {!loaded ? null : vars.length === 0 && !adding ? (
        <Card>
          <TText style={{ color: colors.muted }}>{t("env.settings.empty")}</TText>
        </Card>
      ) : (
        vars.map((name) => (
          <View key={name}>
            <View
              style={{
                padding: 12,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.card,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <TText style={{ fontWeight: "700" }}>{name}</TText>
                {/* Values never render — a masked marker is all she sees. */}
                <TText style={[s.small, { color: colors.muted }]}>••••••••</TText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("env.settings.edit")}
                onPress={() => setEditing((e) => (e === name ? null : name))}
                style={{ padding: 8 }}
              >
                <TText style={{ color: colors.blueDark }}>{t("env.settings.edit")}</TText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("env.settings.delete")}
                onPress={() => confirmDelete(name)}
                style={{ padding: 8 }}
              >
                <TText style={{ color: colors.danger }}>{t("env.settings.delete")}</TText>
              </Pressable>
            </View>
            {editing === name ? (
              <View style={{ marginTop: 8 }}>
                <VarForm initialName={name} onDone={() => setEditing(null)} />
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
