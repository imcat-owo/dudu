/**
 * Daily mood check-in （每日心情 check-in） — Shanghai wall-clock helpers.
 * PURE module: no React Native / expo imports, no I/O. All time flows
 * through arguments, so tests can pin any moment.
 *
 * She is nocturnal (awake at night, asleep 06:00–16:00 Shanghai) — the
 * check-in hour defaults to 20:00 and may never fall inside her sleep
 * window. Everything here is her wall clock, not UTC.
 */

export interface ShanghaiParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

export function shanghaiParts(ms: number): ShanghaiParts {
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
export function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const w = shanghaiParts(guess);
  const wallAsUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return guess - (wallAsUTC - guess);
}

/** "YYYY-MM-DD" in her wall clock — the mood timeline's day key. */
export function shanghaiDayKey(ms: number): string {
  const p = shanghaiParts(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Epoch ms of HH:00 on the Shanghai day containing `ms`. */
export function shanghaiHourToday(ms: number, hour: number): number {
  const p = shanghaiParts(ms);
  return shanghaiWallToMs({ ...p, h: hour, mi: 0 });
}

/** "M月d日" label for memory/timeline, her wall clock. */
export function shanghaiDateLabel(ms: number): string {
  const p = shanghaiParts(ms);
  return `${p.mo}月${p.d}日`;
}
