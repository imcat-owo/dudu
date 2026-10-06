/**
 * Incognito guard (P1-3): an incognito session promised zero trace.
 *
 * No memory writes, no our-space writes, no task writes, no theme writes,
 * no backups, no knowledge writes, no skill changes, no playlist/track
 * changes, no dialog management. Reads stay available — looking at data
 * leaves no trace. Out-of-app tools behind the authorize gate (calendar,
 * reminders) are untouched: she approves each one explicitly.
 *
 * Two layers:
 * 1. The agent filters these tools out of the prompt/registry in incognito
 *    mode, so the AI never sees them.
 * 2. The tool loop refuses them loudly if invoked anyway (defense in depth).
 *
 * When adding a new write tool, add its name here.
 */

/** Tool names that persist data and must never run in an incognito session. */
const INCOGNITO_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  // AI memory
  "memory_add",
  "memory_update",
  "memory_delete",
  "memory_confirm",
  "memory_reinforce", // ai-use P1-1: reinforce writes reinforcedCount/updatedAt/event log — real persistence
  // Our Space (status, mood, diary, timeline, tell-later, notes, feed,
  // anniversaries, works, love letters, task cards, ambient video)
  "my_status_update",
  "her_mood_update",
  "nickname_set",
  "together_since_set",
  "diary_write",
  "diary_delete",
  "timeline_add",
  "timeline_delete",
  "tell_later_add",
  "tell_later_done",
  "tell_later_delete",
  "leave_note",
  "left_note_delete",
  "feed_post",
  "feed_post_delete",
  "feed_reply",
  "feed_reply_delete",
  "feed_like",
  "anniversary_add",
  "anniversary_delete",
  "work_add",
  "work_delete",
  "love_letter_write",
  "love_letter_delete",
  "task_progress_update",
  "task_progress_dismiss",
  "ambient_video_set",
  // Theme & appearance
  "set_wallpaper",
  "set_theme",
  "set_ai_avatar",
  "set_font_size",
  // Backup (create writes a file; restore rewrites everything)
  "backup_create",
  "backup_restore",
  // Voice (set voice persists; podcast writes task-progress entries;
  // voice notes write audio files)
  "set_tts_voice",
  "generate_podcast",
  "speak_as_voice",
  // Video generation (task-progress entries + files)
  "generate_video",
  // Dialog management (creates/renames persistent dialogs; plans persist too)
  "new_dialog",
  "rename_dialog",
  "propose_coordination_plan", // ai-use P1-2: persists to dudu.plan-gate.v1 + pops a plan card
  // B5: the cross_dialog agent CLI (list/search/read other dialogs) reads dialog
  // metadata — in incognito the persona is unresolved so isolation can't be
  // enforced, and cross-session reads break the "zero trace" promise.
  // Fail closed: hidden from the prompt/registry + refused loudly.
  "cross_dialog",
  // Knowledge base
  "knowledge_add_doc",
  "knowledge_reindex",
  "knowledge_add_file",
  // Skills
  "skill_create",
  "skill_update",
  "skill_delete",
  "skill_import", // D8: imports a skill — a real store write, same as skill_create
  // Music room (persistent library changes; playback controls stay)
  "music_track_add",
  "music_track_delete",
  "music_lyrics_add",
  "music_playlist_create",
  "music_playlist_add",
  "music_comment_add",
  "music_comment_delete", // ai-use P2-4: the new tool persists too
  "music_ours_add",
  "music_memory_add",
  "dj_queue_add",
  // Device writes
  "write_clipboard",
  // Secrets
  "ask_env_form", // D15: persists a secret into envStore — a real write
  // Coding loop (E3): writes to her sandbox + persists task records
  "coding_task",
  // Proactive initiative (Aru-gap): rule store writes + schedules notifications
  "initiative_rule_create",
  "initiative_rule_archive",
  "initiative_rule_restore",
  "initiative_rule_delete",
  "initiative_rule_run_now",
  // Character cards (E1): import writes persona + lorebook + avatar; export
  // upserts persona (refreshes stored card) + writes the card PNG file
  "chara_import",
  "chara_export",
  // Exchange import (Aru-gap): writes imported dialog threads
  "exchange_import",
  // Persona group chat: group store writes (create/members/model/archive)
  "persona_group_create",
  "persona_group_add_member",
  "persona_group_remove_member",
  "persona_group_set_model",
  "persona_group_archive",
  // AI self-post trigger: config writes + manual post (reads stay available)
  "selfpost_config",
  "selfpost_post_now",
]);

/** True when this tool must be refused in an incognito session. */
export function isBlockedInIncognito(toolName: string): boolean {
  return INCOGNITO_BLOCKED_TOOLS.has(toolName);
}

/**
 * Refusal text for the tool loop (goes to the AI as a tool error, in the
 * same voice as the other incognito refusals). The AI relays it honestly
 * instead of pretending the write happened.
 */
export function incognitoRefusal(toolName: string): string {
  return (
    `This session is incognito — it promised no side effects, so I can't run "${toolName}" here. ` +
    `Tell her to turn incognito off first, then I'll do it.`
  );
}

/**
 * System-prompt section injected when the session is incognito. The AI must
 * KNOW it's incognito (P1-3) — otherwise it promises "I'll remember this"
 * for a session that remembers nothing.
 */
export function buildIncognitoPromptSection(): string {
  return (
    "Incognito session — leave zero trace:\n" +
    "- This conversation is NOT saved to history. Do not try to save it.\n" +
    "- Save NOTHING: no memories, no diary/status/mood/timeline/tell-later/notes, " +
    "no tasks, no theme/wallpaper/avatar changes, no backups, no knowledge entries, " +
    "no skill changes, no playlist/track changes. The write tools are hidden from you " +
    "this session — if she asks for one, explain incognito means nothing is kept and " +
    "ask her to turn incognito off first.\n" +
    "- Never promise \"I'll remember this\" — you won't. Be honest about it." +
    "- One honest exception: out-of-app actions she approves herself (calendar, reminders) " +
    "still ask her for permission. If she approves one, it leaves a real record — so tell her " +
    'plainly BEFORE she approves: "this will leave a record, breaking the incognito promise; ' +
    'still want it?" Never let it happen silently.'
  );
}
