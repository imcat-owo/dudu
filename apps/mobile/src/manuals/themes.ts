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
- AI theme tools let the AI adjust wallpaper, theme, and avatar inside the
  theme system — still token-driven, still no hardcoded colors.`,
};
