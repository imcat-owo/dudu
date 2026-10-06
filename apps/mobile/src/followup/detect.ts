/**
 * Memory-driven next-day follow-up （次日跟进） — detection. PURE module:
 * no React Native / expo imports, no I/O. All time flows through `nowMs`.
 *
 * Spots a future-dated commitment/event in her words ("我明天有个面试",
 * "下周三要去看牙") and turns it into { what, eventDate, followUpAt }.
 * Conservative by design: when the date or the "what" is unclear, it
 * returns null — a missed follow-up is invisible, a wrong one is a pest.
 */

export interface DetectedFollowup {
  /** The event, e.g. "面试". */
  what: string;
  /** Shanghai day start (ms) of the event date. */
  eventDateMs: number;
  /** Her own date phrase, e.g. "明天", "下周三", "5月20日". */
  eventLabel: string;
  /** When the follow-up fires: the day AFTER the event, 17:00 Shanghai
   * (her "morning" — she sleeps 06:00–16:00, so this respects her rhythm
   * and never lands in her sleep window). */
  followUpAtMs: number;
  /** Keywords for the auto-cancel "already discussed" check. */
  keywords: string[];
}

const DAY_MS = 86_400_000;

interface ShanghaiParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function shanghaiParts(ms: number): ShanghaiParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour") % 24,
    mi: get("minute"),
  };
}

/** Shanghai wall-clock → epoch ms. Shanghai has no DST: one pass is exact. */
function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(guess)).find((x) => x.type === type)?.value ?? "0");
  const wallAsUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
  );
  return guess - (wallAsUTC - guess);
}

function shanghaiDayStart(ms: number): number {
  const p = shanghaiParts(ms);
  return shanghaiWallToMs({ ...p, h: 0, mi: 0 });
}

/** 0=Sunday … 6=Saturday, Shanghai wall clock. */
function shanghaiWeekday(ms: number): number {
  // shanghaiDayStart is midnight Shanghai = 16:00 UTC previous day, so
  // shift +8h before reading the UTC weekday to get Shanghai's weekday.
  return new Date(shanghaiDayStart(ms) + 8 * 3_600_000).getUTCDay();
}

const WEEKDAY_NUM: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

interface DateHit {
  /** Days from today (Shanghai). */
  daysOut: number;
  /** Her phrase, for the label. */
  phrase: string;
  /** Absolute-date override (month/day), when the phrase names one. */
  month?: number;
  day?: number;
  yearBump?: boolean;
}

/**
 * Find the FIRST future-date expression in the text. Returns null when
 * none is found. Pure.
 */
function findDate(text: string, nowMs: number): DateHit | null {
  const todayStart = shanghaiDayStart(nowMs);
  const p = shanghaiParts(nowMs);

  // Explicit month/day: "5月20日" / "5月20号".
  let m = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let y = p.y;
      let fire = shanghaiWallToMs({ y, mo, d, h: 0, mi: 0 });
      if (fire < todayStart) {
        y += 1;
        fire = shanghaiWallToMs({ y, mo, d, h: 0, mi: 0 });
      }
      return {
        daysOut: Math.round((fire - todayStart) / DAY_MS),
        phrase: m[0],
        month: mo,
        day: d,
      };
    }
  }

  // "下个月15号" / "下月15日".
  m = text.match(/下个?月(\d{1,2})[日号]/);
  if (m) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31) {
      let y = p.y;
      let mo = p.mo + 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
      const fire = shanghaiWallToMs({ y, mo, d, h: 0, mi: 0 });
      return { daysOut: Math.round((fire - todayStart) / DAY_MS), phrase: m[0] };
    }
  }

  // Bare day-of-month: "15号交稿" — next occurrence (next month if passed).
  m = text.match(/(\d{1,2})[日号]/);
  if (m) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31 && d !== p.d) {
      let y = p.y;
      let mo = p.mo;
      let fire = shanghaiWallToMs({ y, mo, d, h: 0, mi: 0 });
      if (fire <= todayStart) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
        fire = shanghaiWallToMs({ y, mo, d, h: 0, mi: 0 });
      }
      // Guard against impossible dates rolling over (e.g. Feb 31 → Mar).
      const check = shanghaiParts(fire);
      if (check.d === d) {
        return { daysOut: Math.round((fire - todayStart) / DAY_MS), phrase: m[0] };
      }
    } else if (d === p.d) {
      return { daysOut: 0, phrase: m[0] };
    }
  }

  // "下周三" / "下星期五" — next week's weekday.
  m = text.match(/下(?:周|星期|礼拜)([一二三四五六日天])/);
  if (m && WEEKDAY_NUM[m[1]] !== undefined) {
    const target = WEEKDAY_NUM[m[1]];
    const today = shanghaiWeekday(nowMs);
    const thisWeek = (target - today + 7) % 7 || 7;
    return { daysOut: thisWeek + 7, phrase: m[0] };
  }

  // "这周五" / "周五" / "星期三" — this week's weekday, strictly future
  // (same weekday → next week; a same-day event gets tomorrow's follow-up
  // anyway, so pushing it out a week is the honest reading).
  m = text.match(/(?:这周|本周|周|星期|礼拜)([一二三四五六日天])/);
  if (m && WEEKDAY_NUM[m[1]] !== undefined) {
    const target = WEEKDAY_NUM[m[1]];
    const today = shanghaiWeekday(nowMs);
    return { daysOut: (target - today + 7) % 7 || 7, phrase: m[0] };
  }

  // Bare "下周" / "下星期".
  if (/下周|下星期|下礼拜/.test(text)) {
    const hit = text.match(/下周|下星期|下礼拜/);
    return { daysOut: 7, phrase: hit ? hit[0] : "下周" };
  }

  if (/大后天/.test(text)) return { daysOut: 3, phrase: "大后天" };
  if (/后天|后日/.test(text)) {
    const hit = text.match(/后天|后日/);
    return { daysOut: 2, phrase: hit ? hit[0] : "后天" };
  }
  if (/明天|明日/.test(text)) {
    const hit = text.match(/明天|明日/);
    return { daysOut: 1, phrase: hit ? hit[0] : "明天" };
  }
  // "月底" — last day of this month.
  if (/月底/.test(text)) {
    const lastDay = new Date(Date.UTC(p.y, p.mo, 0)).getUTCDate();
    const fire = shanghaiWallToMs({ y: p.y, mo: p.mo, d: lastDay, h: 0, mi: 0 });
    if (fire >= todayStart)
      return { daysOut: Math.round((fire - todayStart) / DAY_MS), phrase: "月底" };
  }
  if (/今天|今日|今晚|今早|今天晚上/.test(text)) {
    const hit = text.match(/今天|今日|今晚|今早|今天晚上/);
    return { daysOut: 0, phrase: hit ? hit[0] : "今天" };
  }
  return null;
}

/** Known event nouns — the "what" when one appears near the date. */
const EVENT_NOUNS = [
  "面试",
  "复试",
  "初试",
  "终面",
  "考试",
  "测验",
  "答辩",
  "看牙",
  "拔牙",
  "洗牙",
  "正畸",
  "看病",
  "体检",
  "复查",
  "产检",
  "手术",
  "疫苗",
  "献血",
  "交稿",
  "截稿",
  "交作业",
  "开会",
  "出差",
  "旅行",
  "出游",
  "约会",
  "相亲",
  "演出",
  "比赛",
  "竞赛",
  "考核",
  "评审",
  "签约",
  "搬家",
  "入职",
  "离职",
  "聚会",
  "婚礼",
  "上课",
  "培训",
  "讲座",
  "直播",
  "录制",
  "拍摄",
  "彩排",
  "试镜",
  "述职",
  "转正",
  "年会",
  "团建",
  "投标",
  "谈判",
  "开庭",
  "庭审",
  "听证",
  "路演",
  "发布会",
  "义诊",
  "献血",
  "捐款",
];

const LEADING_STRIP =
  /^(我|我们|你|她|他|它|要|得|会|将要|准备|打算|有个|有|去|得去|要去|想去|约了|定了|得|跟|和|给|帮|陪|带|接|送|参加|出席)+/;
const TRAILING_STRIP = /(啊|呀|呢|吧|了|一下|一趟|一次|一番)+$/;

/**
 * Extract the "what" from the text with the date phrase removed.
 * Returns the what plus whether it came from a known event noun.
 * Same-day mentions ("今天好累") are states, not events — they only
 * count when a real event noun is present.
 */
function extractWhat(
  text: string,
  datePhrase: string,
  daysOut: number,
): { what: string; isNoun: boolean } | null {
  const rest = text.replace(datePhrase, "");
  const cleaned = rest.replace(LEADING_STRIP, "").replace(TRAILING_STRIP, "").trim();
  if (!cleaned) return null;
  for (const noun of EVENT_NOUNS) {
    if (cleaned.includes(noun)) return { what: noun, isNoun: true };
  }
  if (daysOut === 0) return null;
  // Fallback: a short cleaned remainder is the event itself.
  if (cleaned.length >= 2 && cleaned.length <= 12) return { what: cleaned, isNoun: false };
  return null;
}

/**
 * Detect a future-dated commitment/event in her words.
 * Returns null when there is no future date or no identifiable "what".
 * Never throws.
 */
export function detectFollowup(text: string, nowMs: number = Date.now()): DetectedFollowup | null {
  try {
    if (!text || text.trim().length === 0) return null;
    const hit = findDate(text, nowMs);
    if (!hit) return null;
    const eventDateMs = shanghaiDayStart(nowMs) + hit.daysOut * DAY_MS;
    const found = extractWhat(text, hit.phrase, hit.daysOut);
    if (!found) return null;
    const what = found.what;
    // Follow-up: the day AFTER the event, 17:00 Shanghai — her "morning".
    const followUpAtMs = eventDateMs + DAY_MS + 17 * 3_600_000;
    const keywords = [what];
    for (const noun of EVENT_NOUNS) {
      if (noun !== what && text.includes(noun)) keywords.push(noun);
    }
    return {
      what,
      eventDateMs,
      eventLabel: hit.phrase,
      followUpAtMs,
      keywords: [...new Set(keywords)],
    };
  } catch {
    return null;
  }
}
