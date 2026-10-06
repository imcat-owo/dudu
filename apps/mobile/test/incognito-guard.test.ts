import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIncognitoPromptSection,
  incognitoRefusal,
  isBlockedInIncognito,
} from "../src/api-groups/incognito-guard.js";

// NOTE: buildLocalSystemPrompt lives in local-agent.ts, whose import graph
// pulls react-native (Flow syntax) — tsx cannot load it in this environment
// (pre-existing; test/incognito.test.ts and test/local-tools.test.ts fail the
// same way). The incognito wiring there is: filter write tools from the
// prompt/registry + pass { isIncognito: true } into buildLocalSystemPrompt,
// verified by tsc + review. This file pins the pure guard contract.

describe("incognito guard (P1-3: zero trace)", () => {
  it("blocks the durable write tools", () => {
    const writes = [
      "memory_add",
      "memory_update",
      "memory_delete",
      "memory_confirm",
      "memory_reinforce",
      "diary_write",
      "diary_delete",
      "my_status_update",
      "her_mood_update",
      "nickname_set",
      "together_since_set",
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
      "set_theme",
      "set_wallpaper",
      "set_ai_avatar",
      "set_font_size",
      "backup_create",
      "backup_restore",
      "set_tts_voice",
      "generate_podcast",
      "speak_as_voice",
      "generate_video",
      "new_dialog",
      "rename_dialog",
      "propose_coordination_plan",
      "knowledge_add_doc",
      "knowledge_add_file",
      "knowledge_reindex",
      "skill_create",
      "skill_update",
      "skill_delete",
      "skill_import",
      "music_track_add",
      "music_track_delete",
      "music_lyrics_add",
      "music_playlist_create",
      "music_playlist_add",
      "music_comment_add",
      "music_comment_delete",
      "music_ours_add",
      "music_memory_add",
      "dj_queue_add",
      "write_clipboard",
      "cross_dialog",
      "coding_task",
      "initiative_rule_create",
      "initiative_rule_archive",
      "initiative_rule_restore",
      "initiative_rule_delete",
      "initiative_rule_run_now",
      "chara_import",
      "chara_export",
      "exchange_import",
      "persona_group_create",
      "persona_group_add_member",
      "persona_group_remove_member",
      "persona_group_set_model",
      "persona_group_archive",
      // AI self-post trigger (write tools; reads stay available)
      "selfpost_config",
      "selfpost_post_now",
      "propose_voice_call",
      // Memory-driven next-day follow-up (write tools; followup_list stays readable)
      "followup_add",
      "followup_delete",
      "followup_set_enabled",
      // Daily mood check-in (write tools; moodcheck_list stays readable)
      "moodcheck_record",
      "moodcheck_delete",
      "moodcheck_set_config",
      "milestone_celebration_set_enabled",
      "milestone_celebration_cancel",
      // AI photo share (write tools; status/log stay readable)
      "photoshare_config",
      "photoshare_share_now",
      // Personality evolution (write tools; evolution_note_list stays readable)
      "evolution_note_add",
      "evolution_note_edit",
      "evolution_note_delete",
      "evolution_set_enabled",
      "evolution_reset",
      // Interactive story mode (write tools; story_list/_show stay readable)
      "story_start",
      "story_scene_add",
      "story_choose",
      "story_bible_update",
      "story_pause",
      "story_resume",
      "story_end",
      "story_delete",
    ];
    for (const name of writes) {
      assert.equal(isBlockedInIncognito(name), true, `${name} must be blocked`);
    }
  });

  it("allows read-only and transient tools", () => {
    const reads = [
      "memory_search",
      "diary_read",
      "timeline_read",
      "my_status_read",
      "tell_later_read",
      "love_letter_read",
      "knowledge_search",
      "skill_list",
      "skill_read",
      "music_track_search",
      "music_track_read",
      "dj_play",
      "dj_pause",
      "dj_skip",
      "browser_navigate",
      "browser_snapshot",
      "browser_screenshot",
      "get_current_time",
      "get_app_info",
      "read_manual",
      "list_dialogs",
      "read_dialog",
      "generate_image",
      "backup_status",
      "check_plan_status",
      "initiative_rule_list",
      "chara_preview",
      "persona_group_list",
      // AI self-post trigger (read tools stay available in incognito)
      "selfpost_status",
      "selfpost_log",
    ];
    for (const name of reads) {
      assert.equal(isBlockedInIncognito(name), false, `${name} must stay available`);
    }
  });

  it("refusal names the tool and the reason", () => {
    const msg = incognitoRefusal("memory_add");
    assert.ok(msg.includes("memory_add"));
    assert.ok(msg.toLowerCase().includes("incognito"));
    assert.ok(msg.toLowerCase().includes("no side effects"));
  });

  it("incognito prompt section is honest about what is not kept", () => {
    const section = buildIncognitoPromptSection();
    assert.ok(section.includes("Incognito session"));
    assert.ok(section.includes("zero trace"));
    assert.ok(section.includes("NOT saved"));
    assert.ok(section.includes("Never promise"));
  });

  it("warns before an out-of-app approval breaks the promise (ai-use P2-2)", () => {
    const section = buildIncognitoPromptSection();
    assert.ok(section.includes("leave a record"), "must name the one honest exception");
    assert.ok(
      section.includes("BEFORE she approves"),
      "the AI must warn before she approves, never silently",
    );
  });
});
