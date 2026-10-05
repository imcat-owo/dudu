/** Manual: themes & appearance. PURE — no RN imports. */
export const THEMES_MANUAL = {
  id: "themes",
  title: "Themes & appearance",
  file: "src/manuals/themes.ts",
  when: "changing look, colors, fonts, wallpapers, or avatars",
  body: `# Themes & appearance

- Visual style: Sora gray hand-drawn — warm grays, compact refined type
  (12–14px), delicate not elderly-phone. Never pure black / pure white text.
- All colors come from theme tokens (useTheme / useColors) — no hardcoded
  colors in UI code, ever.
- GLOBAL BAN: zero emoji in any UI. Icons are lucide vector icons or
  images only. Audit with a regex when touching UI.
- Font size follows the system setting; she can also override it in-app,
  and upload custom fonts Kelivo-style.
- AI theme tools (16 total) let the AI work inside the theme system —
  still token-driven, still no hardcoded colors:
  - Stable (10): get_theme (look first), apply_theme_coordinates (four-axis
    recolor: hue feeling-word or hex + hueCount/emotion/meaning),
    apply_surface_tokens (one-surface precision), apply_preset (built-in
    preset by id — never invent one), set_theme (light/dark/system),
    set_wallpaper, set_ai_avatar, preview_theme (try-on, NOT saved),
    confirm_theme (save the preview), rollback_theme (undo last change).
  - Creative (6, only when the AI theme mode is "creative"): read_theme_css,
    replace_theme_css, append_theme_css, edit_theme_css, insert_theme_css,
    delete_theme_css — restricted CSS over the 8 surfaces only, validated
    before applying; layout/interaction/business logic are never writable.
- Preferred flow: preview first, save second (preview_theme ->
  confirm_theme). Zero silent theme changes — she always sees what changed.
- When she names a feeling ("换个粉嫩点的主题"), use
  apply_theme_coordinates with the feeling word, not a guessed hex.`,
};
