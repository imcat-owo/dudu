/**
 * AI video generation tool — output-type tool backend (vision doc §1).
 *
 * Video is slow, so generation runs with a progress card in 我们的空间
 * (task-progress store): submit → poll → complete/fail. The card is the
 * source of truth she can watch while the call is in flight. Like the
 * podcast tool, this call BLOCKS until the video is ready (up to ~10 min);
 * the tool description says so honestly.
 *
 * Backends come from her video capability group (ordered members). Each
 * member carries a full endpoint URL because there is no standard
 * OpenAI-compatible video path — she points it at her provider's real
 * API. No fake generation, ever: unconfigured → honest ToolError;
 * unrecognized provider responses → honest error on the card; a "done"
 * without a playable link is reported as such, never as a link.
 *
 * PURE module: expo/task-progress imports are type-only or injected.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import type { TaskProgressStore } from "../our-space/task-progress.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export interface VideoBackend {
  name: string;
  /** Full URL to POST the generation request to (provider-specific). */
  endpoint: string;
  /**
   * Optional URL polled for async completion. Use {id} where the remote
   * task id goes; when the placeholder is absent the id is appended as a
   * ?task_id= query param.
   */
  pollEndpoint?: string;
  apiKey?: string;
  headers: Record<string, string>;
  model: string;
}

/** Poll timing knobs — injectable so tests don't wait 10 real minutes. */
export interface VideoPollTiming {
  submitTimeoutMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface VideoToolDeps {
  /** Ordered backends from her video capability group. Fresh every run. */
  resolveBackends: () => VideoBackend[];
  tasks: TaskProgressStore;
  poll?: VideoPollTiming;
}

const DEFAULT_TIMING = {
  submitTimeoutMs: 60000,
  intervalMs: 5000,
  timeoutMs: 10 * 60 * 1000,
} as const;

function headersFor(b: VideoBackend): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = (b.apiKey ?? "").trim();
  if (key) h.Authorization = `Bearer ${key}`;
  return { ...h, ...b.headers };
}

/** Try common response shapes for a finished video URL. */
export function extractVideoUrl(data: unknown): string | null {
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  for (const key of ["video_url", "url", "result_url", "output_url", "download_url"]) {
    const v = d[key];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  const nested = d.data ?? d.result ?? d.output;
  if (Array.isArray(nested) && nested.length > 0) {
    const u = extractVideoUrl(nested[0]);
    if (u) return u;
  } else if (nested && typeof nested === "object") {
    const u = extractVideoUrl(nested);
    if (u) return u;
  }
  return null;
}

/** Try common shapes for an async task id. */
export function extractTaskId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  for (const key of ["task_id", "job_id", "request_id", "id"]) {
    const v = d[key];
    if (typeof v === "string" && v) return v;
  }
  const nested = d.data;
  if (nested && typeof nested === "object") return extractTaskId(nested);
  return null;
}

export function taskDone(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  // P2-15: providers shout ("SUCCEEDED") — compare case-insensitively or
  // the poll spins the full 10 minutes then times out.
  const status = String(d.status ?? d.state ?? "").toLowerCase();
  return (
    status === "completed" || status === "done" || status === "succeeded" || status === "success"
  );
}

export function taskFailed(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const status = String(d.status ?? d.state ?? "").toLowerCase();
  if (status === "failed" || status === "error" || status === "cancelled") {
    const err = d.error ?? d.message;
    return typeof err === "string" ? err : `task ${status}`;
  }
  return null;
}

/**
 * P2-14: verify a candidate video URL actually serves video before we
 * present it as "the video". HEAD (2xx + content-type video/*); servers
 * that reject HEAD get one 1-byte range-GET chance. Anything else →
 * false, and the caller takes the honest "no playable link" path instead
 * of handing her a dead link.
 */
export async function verifyVideoUrl(url: string, timeoutMs = 10000): Promise<boolean> {
  const check = async (method: string, range: boolean): Promise<boolean> => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(
        url,
        range
          ? { method, headers: { Range: "bytes=0-0" }, signal: c.signal }
          : { method, signal: c.signal },
      );
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") ?? "";
      return ct.toLowerCase().startsWith("video/");
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  };
  if (await check("HEAD", false)) return true;
  return check("GET", true);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: c.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: c.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(t);
  }
}

export function createVideoTools(deps: VideoToolDeps): LocalTool[] {
  return [
    {
      name: "generate_video",
      description:
        "生成视频。注意：这一步很慢——调用会一直等到视频做好才返回（最多约 10 分钟），期间她可以在「我们的空间」看到进度卡。调用前先告诉她要花点时间，让她别干等。prompt 用英文写具体些：主体、动作、风格、氛围。返回后把视频链接发给她。如果还没配置视频模型，如实告诉她去「分组 → 能力分组 → 视频」里加一个，不要编造链接。",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "英文视频 prompt：主体、动作、风格、氛围，越具体越好。",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      manualId: "media",
      run: async (args) => {
        const prompt = strArg(args, "prompt").trim();
        if (!prompt) throw new ToolError("prompt is required.");
        const backends = deps.resolveBackends();
        if (backends.length === 0) {
          throw new ToolError(
            "还没有配置视频模型：在「分组 → 能力分组 → 视频」里添加一个视频模型（填它的生成接口地址），再让我试。不要编造视频链接。",
          );
        }
        const timing = {
          submitTimeoutMs: deps.poll?.submitTimeoutMs ?? DEFAULT_TIMING.submitTimeoutMs,
          intervalMs: deps.poll?.intervalMs ?? DEFAULT_TIMING.intervalMs,
          timeoutMs: deps.poll?.timeoutMs ?? DEFAULT_TIMING.timeoutMs,
        };
        const errors: string[] = [];
        for (const b of backends) {
          try {
            return await runBackend(b, prompt, deps.tasks, timing);
          } catch (e) {
            errors.push(`${b.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        throw new ToolError(
          `视频生成失败：${errors.join("；")}。如实告诉她没做出来，不要给假链接。`,
        );
      },
    },
  ];
}

interface ResolvedTiming {
  submitTimeoutMs: number;
  intervalMs: number;
  timeoutMs: number;
}

async function runBackend(
  b: VideoBackend,
  prompt: string,
  tasks: TaskProgressStore,
  timing: ResolvedTiming,
): Promise<string> {
  // P3-17: random suffix — two videos started in the same millisecond
  // must not share a task id.
  const taskId = `video_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const headers = headersFor(b);
  const shortPrompt = prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt;
  const card = (progress: number, stage: string, status: "running" | "stuck" | "done") =>
    tasks.upsert({
      id: taskId,
      name: `做视频：${shortPrompt}`,
      progress,
      stage,
      status,
      backgroundUri: null,
    });
  await card(0.05, "提交生成请求…", "running");

  const fail = (stage: string): Promise<never> =>
    card(0.05, stage, "stuck").then(() => {
      throw new Error(stage);
    });

  // 1. Submit.
  let submitted: unknown;
  try {
    submitted = await postJson(
      b.endpoint,
      headers,
      { model: b.model || undefined, prompt },
      timing.submitTimeoutMs,
    );
  } catch (e) {
    return fail(`提交失败：${e instanceof Error ? e.message : String(e)}`);
  }

  // 2a. Synchronous provider — video URL straight back.
  const direct = extractVideoUrl(submitted);
  if (direct) {
    // P2-14: the URL must actually serve video before we present it.
    if (await verifyVideoUrl(direct)) {
      await card(1, "完成了", "done");
      return videoDoneMessage(prompt, direct);
    }
    const stage = `生成返回了视频地址，但验证打不开或不是视频文件`;
    await card(1, stage, "stuck");
    return (
      `视频应该已经做好了，但我验证了一下返回的链接，打不开或不是视频文件，` +
      `所以不能给你一个坏链接。任务卡（${taskId}）上记着这次任务，` +
      `可以去「我们的空间」看一眼，也可以让我帮你检查视频模型的接口配置。不要编造链接。`
    );
  }

  // 2b. Async provider — poll for completion.
  const remoteId = extractTaskId(submitted);
  if (remoteId && (b.pollEndpoint || b.endpoint)) {
    let pollUrl = (b.pollEndpoint ?? b.endpoint).replace("{id}", remoteId);
    if (!pollUrl.includes(remoteId)) {
      // No {id} placeholder in her poll URL — append the id as a query param
      // so the poll actually identifies the task.
      const sep = pollUrl.includes("?") ? "&" : "?";
      pollUrl = `${pollUrl}${sep}task_id=${encodeURIComponent(remoteId)}`;
    }
    const started = Date.now();
    let polls = 0;
    for (;;) {
      if (Date.now() - started > timing.timeoutMs) {
        return fail("等待超时：任务卡还留着，稍后可以手动查看");
      }
      await new Promise((r) => setTimeout(r, timing.intervalMs));
      polls += 1;
      let state: unknown;
      try {
        state = b.pollEndpoint
          ? await getJson(pollUrl, headers, timing.submitTimeoutMs)
          : await postJson(pollUrl, headers, { task_id: remoteId }, timing.submitTimeoutMs);
      } catch {
        // Poll blip — keep waiting, the card shows elapsed time honestly.
        await card(
          Math.min(0.9, 0.1 + polls * 0.02),
          `渲染中…（已等待 ${Math.round((Date.now() - started) / 1000)} 秒，刚有一次查询失败）`,
          "running",
        );
        continue;
      }
      const failed = taskFailed(state);
      if (failed) return fail(`生成失败：${failed}`);
      const url = extractVideoUrl(state);
      if (url || taskDone(state)) {
        if (!url) {
          // Provider says done but there's no playable link in the response —
          // never present the poll URL as "the video link".
          const stage = `生成完成，但返回里找不到视频地址（任务 ${remoteId}）`;
          await card(1, stage, "stuck");
          return (
            `视频应该已经做好了，但我从接口返回里找不到可以直接播放的视频地址，` +
            `所以不能给你一个链接。任务卡（${taskId}）上记着这次任务，` +
            `可以去「我们的空间」看一眼，也可以让我帮你检查视频模型的接口配置。不要编造链接。`
          );
        }
        // P2-14: verify before presenting — a non-video URL is never "the video".
        if (!(await verifyVideoUrl(url))) {
          const stage = `生成完成，但返回的链接验证不是视频文件（任务 ${remoteId}）`;
          await card(1, stage, "stuck");
          return (
            `视频应该已经做好了，但我验证了一下返回的链接，打不开或不是视频文件，` +
            `所以不能给你一个坏链接。任务卡（${taskId}）上记着这次任务，` +
            `可以去「我们的空间」看一眼，也可以让我帮你检查视频模型的接口配置。不要编造链接。`
          );
        }
        await card(1, "完成了", "done");
        return videoDoneMessage(prompt, url);
      }
      await card(
        Math.min(0.9, 0.1 + polls * 0.02),
        `渲染中…（已等待 ${Math.round((Date.now() - started) / 1000)} 秒）`,
        "running",
      );
    }
  }

  return fail("接口返回了无法识别的结果：既没有视频地址也没有任务 ID");
}

function videoDoneMessage(prompt: string, url: string): string {
  return (
    `视频做好了（"${prompt}"）：\n${url}\n` +
    `进度卡已标记完成。直接把上面的链接发给她，告诉她点开就能看。不要编造封面或时长。`
  );
}
