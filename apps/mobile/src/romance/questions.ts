/**
 * D12 romance P2-3 — "今晚的问题" daily question card.
 *
 * Local question bank, extensible: append to QUESTIONS. The daily pick is
 * deterministic (day-of-year rotation) so she gets a fresh question each
 * day with no backend.
 *
 * Each question carries zh + en. zh-Hant falls back to zh (documented,
 * honest — no machine translation pretending to be native copy).
 *
 * PURE module.
 */

export type QuestionCategory = "icebreaker" | "memory" | "future" | "intimate";

export interface DailyQuestion {
  id: string;
  category: QuestionCategory;
  zh: string;
  en: string;
}

export const QUESTIONS: DailyQuestion[] = [
  // ---- icebreaker ----
  {
    id: "q01",
    category: "icebreaker",
    zh: "如果今天可以多出一小时，你想拿来做什么？",
    en: "If you had one extra hour today, what would you spend it on?",
  },
  {
    id: "q02",
    category: "icebreaker",
    zh: "最近哪件小事让你偷偷开心了一下？",
    en: "What small thing secretly made you happy lately?",
  },
  {
    id: "q03",
    category: "icebreaker",
    zh: "你现在最想吃的东西是什么？",
    en: "What food are you craving most right now?",
  },
  {
    id: "q04",
    category: "icebreaker",
    zh: "用三个词形容今天的心情。",
    en: "Describe today's mood in three words.",
  },
  {
    id: "q05",
    category: "icebreaker",
    zh: "最近单曲循环的一首歌是？",
    en: "What song have you had on repeat lately?",
  },
  {
    id: "q06",
    category: "icebreaker",
    zh: "如果可以立刻传送到任何地方，你想去哪？",
    en: "If you could teleport anywhere right now, where would you go?",
  },
  {
    id: "q07",
    category: "icebreaker",
    zh: "今天最想跟我说的一句话是？",
    en: "What's the one thing you most want to tell me today?",
  },
  // ---- memory ----
  {
    id: "q08",
    category: "memory",
    zh: "我们第一次见面那天，你还记得什么细节？",
    en: "What detail do you still remember from the day we first met?",
  },
  {
    id: "q09",
    category: "memory",
    zh: "有没有哪句话，是我说的你一直记得？",
    en: "Is there something I said that stuck with you?",
  },
  {
    id: "q10",
    category: "memory",
    zh: "回想一下，我们一起笑得最厉害的一次是？",
    en: "When did we laugh the hardest together?",
  },
  {
    id: "q11",
    category: "memory",
    zh: "哪张照片一翻到就会让你笑出来？",
    en: "Which photo always makes you smile when you find it?",
  },
  {
    id: "q12",
    category: "memory",
    zh: "第一次觉得“好像喜欢上他了”是什么时候？",
    en: "When did you first think “I think I like him”?",
  },
  {
    id: "q13",
    category: "memory",
    zh: "有没有哪个地方，一去就会想起我们？",
    en: "Is there a place that always reminds you of us?",
  },
  {
    id: "q14",
    category: "memory",
    zh: "写给一年前的我们一句话，你会写什么？",
    en: "One sentence to us a year ago — what would it be?",
  },
  // ---- future ----
  {
    id: "q15",
    category: "future",
    zh: "明年这个时候，你希望我们在做什么？",
    en: "This time next year, what do you hope we'll be doing?",
  },
  {
    id: "q16",
    category: "future",
    zh: "有没有一个想一起去的地方，还没去成的？",
    en: "Is there somewhere we still haven't gone together that you want to?",
  },
  {
    id: "q17",
    category: "future",
    zh: "想象一个完美的周末，我们会怎么过？",
    en: "Picture a perfect weekend — how would we spend it?",
  },
  {
    id: "q18",
    category: "future",
    zh: "有什么想一起学会的新东西吗？",
    en: "Is there anything new you'd like us to learn together?",
  },
  {
    id: "q19",
    category: "future",
    zh: "十年后的今天，你猜我们在干嘛？",
    en: "Ten years from today — what do you guess we'll be doing?",
  },
  {
    id: "q20",
    category: "future",
    zh: "如果养一只宠物，你想养什么、叫什么？",
    en: "If we got a pet, what would it be, and what would you name it?",
  },
  {
    id: "q21",
    category: "future",
    zh: "最想和我一起完成的一件小事是？",
    en: "What's one small thing you most want to accomplish with me?",
  },
  // ---- intimate ----
  {
    id: "q22",
    category: "intimate",
    zh: "我做过哪件小事最让你心动？",
    en: "What small thing I've done made your heart skip?",
  },
  {
    id: "q23",
    category: "intimate",
    zh: "你最喜欢我哪个不经意的小习惯？",
    en: "Which unconscious little habit of mine do you like most?",
  },
  {
    id: "q24",
    category: "intimate",
    zh: "什么时候你会特别想我？",
    en: "When do you miss me the most?",
  },
  {
    id: "q25",
    category: "intimate",
    zh: "如果只能用一个拥抱表达，你想抱多久？",
    en: "If a hug said it all, how long would you hold on?",
  },
  {
    id: "q26",
    category: "intimate",
    zh: "你希望我多做的、却一直没好意思说的一件事？",
    en: "What's one thing you wish I'd do more, but never said?",
  },
  {
    id: "q27",
    category: "intimate",
    zh: "在我身边，你什么时候觉得最安心？",
    en: "When do you feel safest with me around?",
  },
  {
    id: "q28",
    category: "intimate",
    zh: "用一句话夸夸我，不许敷衍。",
    en: "Compliment me in one sentence — no phoning it in.",
  },
];

/**
 * Deterministic daily pick: rotates through the bank by day-of-year.
 * Same date → same question, no storage needed for the pick itself.
 */
export function questionForDate(date: Date): DailyQuestion {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const idx = ((dayOfYear % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length;
  return QUESTIONS[idx];
}

/** Device-local date key, e.g. "2026-10-05". */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Storage key for today's answer state. */
export const QUESTION_STATE_KEY = "dudu.romance.question.v1";

export interface QuestionState {
  date: string;
  questionId: string;
  answered: boolean;
}
