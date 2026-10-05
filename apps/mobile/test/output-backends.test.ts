/**
 * Output-type tool backend tests: image_output group wiring + generate_video.
 * PURE logic; fetch is stubbed via globalThis.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createImageTools } from "../src/image/tools.js";
import { TaskProgressStore } from "../src/our-space/task-progress.js";
import {
  createVideoTools,
  extractTaskId,
  extractVideoUrl,
  taskDone,
  taskFailed,
} from "../src/video/tools.js";

const ctx = {} as never;

const FAST_POLL = { submitTimeoutMs: 1000, intervalMs: 10, timeoutMs: 5000 };

function videoBackend(over: Partial<import("../src/video/tools.js").VideoBackend> = {}) {
  return {
    name: "视频组",
    endpoint: "https://vid.example.com/make",
    headers: {},
    model: "v",
    ...over,
  };
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
  };
}

function stubFetch(handler: (url: string, init: unknown) => unknown) {
  const prev = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (url: unknown, init: unknown) => {
    const result = handler(String(url), init);
    if (result instanceof Error) throw result;
    const { ok, status, body, contentType } = result as {
      ok: boolean;
      status: number;
      body: string;
      contentType?: string;
    };
    return {
      ok,
      status,
      text: async () => body,
      // P2-14: the product verifies media URLs via res.headers.get("content-type").
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? (contentType ?? "application/octet-stream")
            : null,
      },
    };
  };
  return () => {
    (globalThis as Record<string, unknown>).fetch = prev;
  };
}

test("extractVideoUrl finds common shapes", () => {
  assert.equal(extractVideoUrl({ video_url: "https://x/v.mp4" }), "https://x/v.mp4");
  assert.equal(extractVideoUrl({ data: [{ url: "https://x/a.mp4" }] }), "https://x/a.mp4");
  assert.equal(extractVideoUrl({ result: { url: "https://x/b.mp4" } }), "https://x/b.mp4");
  assert.equal(extractVideoUrl({ nope: 1 }), null);
  assert.equal(extractVideoUrl(null), null);
});

test("extractTaskId finds common shapes", () => {
  assert.equal(extractTaskId({ task_id: "t1" }), "t1");
  assert.equal(extractTaskId({ job_id: "j2" }), "j2");
  assert.equal(extractTaskId({ data: { id: "d3" } }), "d3");
  assert.equal(extractTaskId({}), null);
});

test("taskDone/taskFailed read status shapes", () => {
  assert.equal(taskDone({ status: "completed" }), true);
  assert.equal(taskDone({ state: "succeeded" }), true);
  assert.equal(taskDone({ status: "processing" }), false);
  assert.equal(taskFailed({ status: "failed", error: "boom" }), "boom");
  assert.equal(taskFailed({ status: "processing" }), null);
});

test("generate_image: her image_output backend wins over free fallback", async () => {
  const restore = stubFetch((url) => {
    assert.ok(String(url).endsWith("/images/generations"), `unexpected url ${url}`);
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ data: [{ url: "https://cdn/x.png" }] }),
    };
  });
  try {
    const [tool] = createImageTools({
      resolveBackends: () => [
        {
          name: "画画组",
          baseUrl: "https://img.example.com/v1",
          apiKey: "k",
          headers: {},
          model: "img-model",
        },
      ],
    });
    const out = (await tool.run({ prompt: "a cat" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/x.png"), "backend image url used");
    assert.ok(out.includes("画画组"), "trace names the backend");
  } finally {
    restore();
  }
});

test("generate_image: backend failure falls back to free backend, honestly noted", async () => {
  // Configured backend fails; the free backend (pollinations) verifies fine.
  // (The product verifies the free URL before claiming success — the stub
  // must let that verification through, or the honest ToolError is correct.)
  const restore = stubFetch((url) =>
    String(url).includes("pollinations")
      ? { ok: true, status: 200, body: "fake-image-bytes" }
      : { ok: false, status: 500, body: "nope" },
  );
  try {
    const [tool] = createImageTools({
      resolveBackends: () => [
        { name: "坏组", baseUrl: "https://img.example.com", headers: {}, model: "m" },
      ],
    });
    const out = (await tool.run({ prompt: "a cat" }, ctx)) as string;
    assert.ok(out.includes("pollinations") || out.includes("image.pollinations.ai"));
    assert.ok(out.includes("坏组"), "fallback is disclosed");
  } finally {
    restore();
  }
});

test("generate_image: no backends -> free backend, no crash", async () => {
  const [tool] = createImageTools();
  const out = (await tool.run({ prompt: "a cat" }, ctx)) as string;
  assert.ok(out.includes("image.pollinations.ai"));
});

test("generate_video: no backends -> honest ToolError, no fake link", async () => {
  const tasks = new TaskProgressStore(memStorage());
  const [tool] = createVideoTools({ resolveBackends: () => [], tasks });
  await assert.rejects(() => tool.run({ prompt: "x" }, ctx), /还没有配置视频模型/);
  assert.equal(tasks.list().length, 0, "no card created when unconfigured");
});

test("generate_video: sync backend -> card done, url returned", async () => {
  const restore = stubFetch((url) => {
    // P2-14: the product HEAD/GETs the returned URL to verify it serves video.
    if (String(url).startsWith("https://cdn/")) {
      return { ok: true, status: 200, body: "", contentType: "video/mp4" };
    }
    assert.equal(url, "https://vid.example.com/make");
    return { ok: true, status: 200, body: JSON.stringify({ video_url: "https://cdn/v.mp4" }) };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [
        {
          name: "视频组",
          endpoint: "https://vid.example.com/make",
          headers: {},
          model: "v-model",
        },
      ],
      tasks,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/v.mp4"));
    const cards = tasks.list();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].status, "done");
    assert.equal(cards[0].progress, 1);
  } finally {
    restore();
  }
});

test("generate_video: submit failure -> card stuck, honest error", async () => {
  const restore = stubFetch(() => ({ ok: false, status: 500, body: "broken" }));
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [
        { name: "视频组", endpoint: "https://vid.example.com/make", headers: {}, model: "v" },
      ],
      tasks,
    });
    await assert.rejects(() => tool.run({ prompt: "waves" }, ctx), /提交失败/);
    const cards = tasks.list();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].status, "stuck");
  } finally {
    restore();
  }
});

test("generate_video: async backend task_id -> poll -> done", async () => {
  const seen: string[] = [];
  let polls = 0;
  const restore = stubFetch((url, init) => {
    seen.push(String(url));
    if (String(url).startsWith("https://cdn/")) {
      return { ok: true, status: 200, body: "", contentType: "video/mp4" };
    }
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method === "POST" && String(url).endsWith("/make")) {
      return { ok: true, status: 200, body: JSON.stringify({ task_id: "t-9" }) };
    }
    polls += 1;
    if (polls < 3) {
      return { ok: true, status: 200, body: JSON.stringify({ status: "processing" }) };
    }
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ status: "completed", video_url: "https://cdn/async.mp4" }),
    };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [
        videoBackend({ pollEndpoint: "https://vid.example.com/status/{id}" }),
      ],
      tasks,
      poll: FAST_POLL,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/async.mp4"), "final video url returned");
    assert.ok(
      seen.some((u) => u.includes("t-9")),
      `poll url must carry the task id, saw: ${seen.join(", ")}`,
    );
    const cards = tasks.list();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].status, "done");
    assert.equal(cards[0].progress, 1);
  } finally {
    restore();
  }
});

test("generate_video: pollEndpoint without {id} appends task_id query", async () => {
  const seen: string[] = [];
  const restore = stubFetch((url, init) => {
    seen.push(String(url));
    if (String(url).startsWith("https://cdn/")) {
      return { ok: true, status: 200, body: "", contentType: "video/mp4" };
    }
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method === "POST") {
      return { ok: true, status: 200, body: JSON.stringify({ task_id: "q-1" }) };
    }
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ status: "done", url: "https://cdn/q.mp4" }),
    };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [videoBackend({ pollEndpoint: "https://vid.example.com/status" })],
      tasks,
      poll: FAST_POLL,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/q.mp4"));
    assert.ok(
      seen.some((u) => u.includes("task_id=q-1")),
      `id must be appended as query, saw: ${seen.join(", ")}`,
    );
  } finally {
    restore();
  }
});

test("generate_video: poll blip recovers, card keeps honest stage", async () => {
  let polls = 0;
  const restore = stubFetch((_url, init) => {
    if (String(_url).startsWith("https://cdn/")) {
      return { ok: true, status: 200, body: "", contentType: "video/mp4" };
    }
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method === "POST") {
      return { ok: true, status: 200, body: JSON.stringify({ job_id: "b-2" }) };
    }
    polls += 1;
    if (polls === 1) return new Error("socket hangup");
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ status: "succeeded", data: [{ url: "https://cdn/blip.mp4" }] }),
    };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [videoBackend({ pollEndpoint: "https://vid.example.com/s/{id}" })],
      tasks,
      poll: FAST_POLL,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/blip.mp4"), "recovers after one poll failure");
    assert.equal(tasks.list()[0].status, "done");
  } finally {
    restore();
  }
});

test("generate_video: done without playable url -> honest, no fake link", async () => {
  const restore = stubFetch((_url, init) => {
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method === "POST") {
      return { ok: true, status: 200, body: JSON.stringify({ task_id: "n-3" }) };
    }
    return { ok: true, status: 200, body: JSON.stringify({ status: "completed" }) };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [videoBackend({ pollEndpoint: "https://vid.example.com/s/{id}" })],
      tasks,
      poll: FAST_POLL,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(!out.includes("https://vid.example.com/s/n-3"), "poll url must not pose as video");
    assert.ok(out.includes("找不到"), "honest about the missing link");
    const cards = tasks.list();
    assert.equal(cards[0].status, "stuck");
  } finally {
    restore();
  }
});

test("generate_video: poll timeout -> stuck card, honest error", async () => {
  const restore = stubFetch((_url, init) => {
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method === "POST") {
      return { ok: true, status: 200, body: JSON.stringify({ task_id: "slow-1" }) };
    }
    return { ok: true, status: 200, body: JSON.stringify({ status: "processing" }) };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [videoBackend({ pollEndpoint: "https://vid.example.com/s/{id}" })],
      tasks,
      poll: { submitTimeoutMs: 1000, intervalMs: 20, timeoutMs: 100 },
    });
    await assert.rejects(() => tool.run({ prompt: "waves" }, ctx), /等待超时/);
    assert.equal(tasks.list()[0].status, "stuck");
  } finally {
    restore();
  }
});

test("generate_video: backend 1 fails -> backend 2 tried (ordered chain)", async () => {
  const hit: string[] = [];
  const restore = stubFetch((url, init) => {
    if (String(url).startsWith("https://cdn/")) {
      return { ok: true, status: 200, body: "", contentType: "video/mp4" };
    }
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method !== "POST") {
      return { ok: true, status: 200, body: JSON.stringify({ status: "done" }) };
    }
    hit.push(String(url));
    if (String(url).includes("one")) {
      return { ok: false, status: 500, body: "down" };
    }
    return { ok: true, status: 200, body: JSON.stringify({ video_url: "https://cdn/two.mp4" }) };
  });
  try {
    const tasks = new TaskProgressStore(memStorage());
    const [tool] = createVideoTools({
      resolveBackends: () => [
        videoBackend({ name: "一号", endpoint: "https://vid.example.com/one" }),
        videoBackend({ name: "二号", endpoint: "https://vid.example.com/two" }),
      ],
      tasks,
      poll: FAST_POLL,
    });
    const out = (await tool.run({ prompt: "waves" }, ctx)) as string;
    assert.ok(out.includes("https://cdn/two.mp4"));
    assert.deepEqual(hit, ["https://vid.example.com/one", "https://vid.example.com/two"]);
  } finally {
    restore();
  }
});
