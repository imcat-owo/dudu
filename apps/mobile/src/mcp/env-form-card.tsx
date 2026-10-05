/**
 * EnvFormCard — the real in-session form card for ask_env_form (D15).
 *
 * Rendered in chat when the AI needs a secret (an API key, an account
 * password). She fills variable name / account / secret / note (URL
 * optional) and taps Save; the secret goes straight into envStore
 * (SecureStore) via answerEnvFormRequest — the model never sees the value.
 *
 * Card follows the same conventions as McpApprovalCard (theme tokens only,
 * no hardcoded colors, zero emoji, TText + t()).
 */

import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, useColors, useStyles } from "../ui";
import { envStore } from "./env";
import {
  answerEnvFormRequest,
  cancelEnvFormRequest,
  type EnvFormRequest,
} from "./env-form";

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  autoCap,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCap?: "none" | "sentences" | "words" | "characters";
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
        autoCapitalize={autoCap ?? "none"}
        autoCorrect={false}
        style={[s.input, secure ? { color: colors.text } : null]}
      />
    </View>
  );
}

export function EnvFormCard({ request }: { request: EnvFormRequest }) {
  const colors = useColors();
  const s = useStyles();
  const [name, setName] = useState(request.varName);
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);

  // If she saved this variable before, say so and pre-fill the
  // non-secret companion fields — she shouldn't have to retype them.
  useEffect(() => {
    let live = true;
    void envStore.getMeta(request.varName).then((meta) => {
      if (!live) return;
      if (meta) {
        setExists(true);
        setAccount(meta.account);
        setNote(meta.note);
        if (meta.url) setUrl(meta.url);
      }
    });
    return () => {
      live = false;
    };
  }, [request.varName]);

  const submit = () => {
    if (!name.trim()) {
      setError(t("env.form.nameRequired"));
      return;
    }
    if (!account.trim()) {
      setError(t("env.form.accountRequired"));
      return;
    }
    if (!secret) {
      setError(t("env.form.secretRequired"));
      return;
    }
    if (!note.trim()) {
      setError(t("env.form.noteRequired"));
      return;
    }
    setError(null);
    answerEnvFormRequest(request.id, {
      name: name.trim(),
      account: account.trim(),
      secret,
      note: note.trim(),
      ...(url.trim() ? { url: url.trim() } : {}),
    });
  };

  return (
    <Card
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderColor: colors.blueDark,
        borderWidth: 1.5,
      }}
    >
      <TText style={{ fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
        {t("env.form.title")}
      </TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
        {request.reason}
      </TText>
      {exists ? (
        <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
          {t("env.form.exists")}
        </TText>
      ) : null}
      <View style={{ gap: 10 }}>
        <Field
          label={t("env.form.name")}
          value={name}
          onChange={setName}
          placeholder="TAVILY_API_KEY"
          autoCap="characters"
        />
        <Field
          label={t("env.form.account")}
          value={account}
          onChange={setAccount}
          placeholder={t("env.form.accountPh")}
        />
        <Field
          label={t("env.form.secret")}
          value={secret}
          onChange={setSecret}
          placeholder={t("env.form.secretPh")}
          secure
        />
        <Field
          label={t("env.form.note")}
          value={note}
          onChange={setNote}
          placeholder={t("env.form.notePh")}
          autoCap="sentences"
        />
        <Field
          label={t("env.form.url")}
          value={url}
          onChange={setUrl}
          placeholder={t("env.form.urlPh")}
        />
      </View>
      {error ? (
        <TText style={[s.small, { color: colors.danger, marginTop: 8 }]}>{error}</TText>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Button small primary onPress={submit}>
            {t("env.form.save")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button small onPress={() => cancelEnvFormRequest(request.id)}>
            {t("common.cancel")}
          </Button>
        </View>
      </View>
    </Card>
  );
}
