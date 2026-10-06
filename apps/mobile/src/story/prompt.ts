/**
 * Interactive story mode （互动故事） — prompt section builder. PURE
 * module: no React Native / expo imports, no I/O.
 *
 * When a dialog has an ACTIVE story, this section rides the system prompt
 * so the narration stays coherent: the story bible is injected verbatim
 * (characters / places / key events), plus progress and her last choice.
 * Empty when there is no story, the story isn't active, incognito is on,
 * or the story belongs to a different persona — no noise, no leakage.
 */

import { latestScene, pendingChoiceScene, type Story } from "./types";

/** Hard budget for the whole section (chars). Bible lists get trimmed first. */
const SECTION_BUDGET = 1600;
const MAX_BIBLE_LINES = 12;

export interface StorySectionOpts {
  /** This dialog's active persona id — stories are persona-isolated. */
  personaId: string | null;
  incognito: boolean;
}

function bibleLines(story: Story): string[] {
  const lines: string[] = [];
  for (const c of story.bible.characters) {
    lines.push(`人物 · ${c.name}${c.desc ? `：${c.desc}` : ""}`);
  }
  for (const p of story.bible.places) {
    lines.push(`地点 · ${p.name}${p.desc ? `：${p.desc}` : ""}`);
  }
  const events = story.bible.events.slice(-4);
  for (const e of events) {
    lines.push(`事件 · ${e.text}`);
  }
  return lines.slice(0, MAX_BIBLE_LINES);
}

/**
 * Build the story-mode section for the system prompt. Returns "" when
 * story mode is not in effect for this dialog.
 */
export function buildStorySection(story: Story | null, opts: StorySectionOpts): string {
  if (opts.incognito) return "";
  if (!story) return "";
  if (story.status !== "active") return "";
  if (!opts.personaId || story.personaId !== opts.personaId) return "";

  const lines: string[] = [];
  lines.push(
    `STORY MODE — 你正在和她合写一个互动故事《${story.title}》，这是故事时间，不是普通聊天。`,
  );
  if (story.premise.trim()) {
    lines.push(`故事开头约定：${story.premise.trim()}`);
  }

  const bible = bibleLines(story);
  if (bible.length > 0) {
    lines.push(
      "故事设定（必须遵守，不许吃书；有新人物/地点/关键事件就用 story_bible_update 记下来）：",
    );
    for (const b of bible) lines.push(`- ${b}`);
  }

  lines.push(`进度：第 ${story.currentChapter} 章，已讲 ${story.scenes.length} 幕。`);

  const last = latestScene(story);
  if (last) {
    const summary = last.summary.length > 200 ? `${last.summary.slice(0, 200)}…` : last.summary;
    lines.push(`上一幕：第 ${last.chapter} 章第 ${last.seq} 幕——${summary}`);
  }
  const pending = pendingChoiceScene(story);
  if (pending && pending.offeredChoices.length > 0) {
    const opts = pending.offeredChoices.map((c) => `${c.id}「${c.label}」`).join(" / ");
    lines.push(
      `她还没选：上一幕给出的选项是 ${opts}。等她选（她说"选X"或点选项），先调 story_choose 记录，再接着讲。`,
    );
  } else {
    // Her most recent recorded pick — even if a later scene was open-ended,
    // the story must keep honoring what she chose.
    const lastChosen = [...story.scenes].reverse().find((sc) => sc.chosenChoiceId);
    if (lastChosen?.chosenChoiceId) {
      const picked = lastChosen.offeredChoices.find((c) => c.id === lastChosen.chosenChoiceId);
      lines.push(
        `她上一次选了：${lastChosen.chosenChoiceId}${picked ? `「${picked.label}」` : ""}（第${lastChosen.chapter}章第${lastChosen.seq}幕）——后面的剧情要接住这个选择。`,
      );
    }
  }

  lines.push(
    "讲法：一幕一幕讲，每幕结尾要么给选项（A/B/C，简短），要么开放式问她接下来想怎样——不要两样都给，也不要把路堵死。" +
      "每讲完一幕，调一次 story_scene_add 记下梗概和给出的选项。" +
      "她说「不玩了」「结束」「换个话题」时，调 story_end 存档，然后自然地回到普通聊天——永远不许把她困在故事里。" +
      "她说「先不玩了」「暂停」时，调 story_pause 存档即可。",
  );

  let section = lines.join("\n");
  if (section.length > SECTION_BUDGET) {
    const cut = section.lastIndexOf("\n", SECTION_BUDGET - 3);
    section = `${section.slice(0, cut > 0 ? cut : SECTION_BUDGET - 3)}…`;
  }
  return section;
}
