/**
 * Custom font support (Phase 1b item 2, aligned with Kelivo).
 *
 * The user can upload a ttf/otf/ttc font file in Appearance → Font.
 * The font is stored OUTSIDE the theme bundle (theme-design.md §8) and
 * managed separately. Missing glyphs fall back to the system font
 * (native font fallback). Default is the system font.
 *
 * TText is a drop-in replacement for RN Text: when no custom font is
 * set it renders identically to <Text>.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Font from "expo-font";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Text, type TextProps } from "react-native";

const FONT_STORAGE_KEY = "openmuse.font.v1";
const FONT_DIR = "openmuse/fonts";
/** The fontFamily name the uploaded font is registered under. */
export const CUSTOM_FONT_FAMILY = "OpenMuseCustom";

type FontState = {
  /** Registered fontFamily, or null for the system font. */
  fontFamily: string | null;
  /** Display name of the uploaded font file, or null. */
  fontName: string | null;
  /** True while the font is being loaded at startup. */
  loading: boolean;
  pickFont: () => Promise<"ok" | "cancelled" | "invalid">;
  clearFont: () => Promise<void>;
};

const FontContext = createContext<FontState>({
  fontFamily: null,
  fontName: null,
  loading: true,
  pickFont: async () => "cancelled",
  clearFont: async () => {},
});

export function useFont(): FontState {
  return useContext(FontContext);
}

async function fontDir(): Promise<string> {
  const dir = `${FileSystem.documentDirectory ?? ""}${FONT_DIR}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function loadPersistedFont(): Promise<{ family: string; name: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(FONT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; file?: string };
    if (!parsed.file || !parsed.name) return null;
    const uri = `${FileSystem.documentDirectory ?? ""}${FONT_DIR}/${parsed.file}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    await Font.loadAsync(CUSTOM_FONT_FAMILY, { uri });
    return { family: CUSTOM_FONT_FAMILY, name: parsed.name };
  } catch {
    return null;
  }
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontName, setFontName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadPersistedFont();
      if (!cancelled) {
        if (loaded) {
          setFontFamily(loaded.family);
          setFontName(loaded.name);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFont = useCallback(async (): Promise<"ok" | "cancelled" | "invalid"> => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["font/ttf", "font/otf", "application/x-font-ttf", "application/x-font-otf", "*.ttf", "*.otf", "*.ttc"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return "cancelled";
    const asset = res.assets[0];
    const name = asset.name ?? "custom-font";
    if (!/\.(ttf|otf|ttc)$/i.test(name)) return "invalid";
    try {
      const dir = await fontDir();
      const dest = `${dir}custom${name.slice(name.lastIndexOf("."))}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      await Font.loadAsync(CUSTOM_FONT_FAMILY, { uri: dest });
      await AsyncStorage.setItem(
        FONT_STORAGE_KEY,
        JSON.stringify({ name, file: dest.split("/").pop() }),
      );
      setFontFamily(CUSTOM_FONT_FAMILY);
      setFontName(name);
      return "ok";
    } catch {
      return "invalid";
    }
  }, []);

  const clearFont = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(FONT_STORAGE_KEY);
      const dir = `${FileSystem.documentDirectory ?? ""}${FONT_DIR}/`;
      await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch {
      // Best effort — the in-memory state is what matters for rendering.
    }
    setFontFamily(null);
    setFontName(null);
  }, []);

  return (
    <FontContext.Provider value={{ fontFamily, fontName, loading, pickFont, clearFont }}>
      {children}
    </FontContext.Provider>
  );
}

/**
 * Drop-in replacement for react-native Text.
 * Applies the user's custom font when one is set; otherwise identical.
 */
export function TText(props: TextProps) {
  const { fontFamily } = useFont();
  const { style, ...rest } = props;
  if (!fontFamily) return <Text {...rest} style={style} />;
  return <Text {...rest} style={[{ fontFamily }, style]} />;
}
