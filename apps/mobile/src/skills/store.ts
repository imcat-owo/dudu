/**
 * Skills (本事包） — user-writable capability packs for the AI. PURE module:
 * no React Native / expo imports, unit-testable in node.
 *
 * A skill is something she teaches the AI: a name, a description, and
 * instructions/steps/preferences in markdown. When the chat touches a
 * related topic, the AI reads the skill and follows it.
 *
 * Example: "旅行规划" — her travel preferences + planning steps.
 * She says "记住以后帮我规划旅行都要先问预算" → the AI saves that
 * as (or into) a skill via skill_create / skill_update.
 *
 * Storage is injectable (AsyncStorage in production, Map-backed fake
 * in tests). Mutations emit to subscribers so the UI refreshes live.
 */

export type SkillAuthor = "her" | "ai";

export interface Skill {
  id: string;
  /** Short name, e.g. "旅行规划". */
  name: string;
  /** One line: what this skill is for. Shown in the index. */
  description: string;
  /** Full instructions/steps/preferences (markdown). Read on demand. */
  instructions: string;
  enabled: boolean;
  /** True for the built-in examples — she can delete them freely. */
  isExample: boolean;
  createdBy: SkillAuthor;
  createdAt: number;
  updatedAt: number;
}

export interface SkillStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const SKILLS_KEY = "openmuse.skills.v1.list";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readJson<T>(storage: SkillStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(storage: SkillStorage, key: string, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value));
}

export function normalizeSkill(s: Skill): Skill {
  return {
    id: typeof s.id === "string" ? s.id : newId("sk"),
    name: typeof s.name === "string" ? s.name : "",
    description: typeof s.description === "string" ? s.description : "",
    instructions: typeof s.instructions === "string" ? s.instructions : "",
    enabled: s.enabled !== false,
    isExample: s.isExample === true,
    createdBy: s.createdBy === "ai" ? "ai" : "her",
    createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
  };
}

/** Seed examples so the list is not empty. Clearly marked, deletable. */
export function seedExampleSkills(): Skill[] {
  const now = Date.now();
  return [
    {
      id: "sk-example-travel",
      name: "旅行规划",
      description: "帮我规划旅行时的偏好和流程",
      instructions: `# 旅行规划

帮我规划旅行时，按这个来：

## 先问清楚
- 出发地、目的地、大概日期、天数
- **预算范围**：先问预算，再推方案（这是铁律）
- 同行人、特殊需求（带娃、无障碍、饮食忌口）

## 偏好
- 住宿：干净安静优先，不追求奢华
- 行程别排太满，每天留半天空着发呆
- 吃的要当地特色，不吃游客陷阱

## 输出
- 按天给行程，标出交通方式和大概花费
- 最后给一个总预算估算`,
      enabled: true,
      isExample: true,
      createdBy: "her",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sk-example-schedule",
      name: "日程安排",
      description: "帮我安排日程时的习惯",
      instructions: `# 日程安排

帮我安排事情时记住：

- 我是夜猫子：重要的事别排在上午
- 事情分三级：今天必须做 / 这周做 / 有空再说
- 别一次塞太多，一天最多三件正事
- 提醒我时提前说，别卡着点`,
      enabled: true,
      isExample: true,
      createdBy: "her",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export class SkillStore {
  private storage: SkillStorage;
  private listeners = new Set<() => void>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(storage: SkillStorage) {
    this.storage = storage;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // a broken listener must not break the store
      }
    }
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Creates seed examples on first run. Idempotent. */
  async ensureSeeded(): Promise<void> {
    await this.enqueueWrite(async () => {
      const raw = await this.storage.getItem(SKILLS_KEY);
      if (raw) return;
      const seeds = seedExampleSkills().map(normalizeSkill);
      await writeJson(this.storage, SKILLS_KEY, seeds);
      this.emit();
    });
  }

  async listSkills(): Promise<Skill[]> {
    await this.ensureSeeded();
    const all = await readJson<Skill[]>(this.storage, SKILLS_KEY, []);
    return all.map(normalizeSkill).sort((a, b) => a.createdAt - b.createdAt);
  }

  async listEnabled(): Promise<Skill[]> {
    const all = await this.listSkills();
    return all.filter((s) => s.enabled);
  }

  async getSkill(id: string): Promise<Skill | null> {
    const all = await this.listSkills();
    return all.find((s) => s.id === id) ?? null;
  }

  async createSkill(input: {
    name: string;
    description?: string;
    instructions?: string;
    createdBy: SkillAuthor;
    isExample?: boolean;
  }): Promise<Skill> {
    return this.enqueueWrite(async () => {
      const name = input.name.trim();
      if (!name) throw new Error("Skill name is required.");
      if (name.length > 40) throw new Error("Skill name too long (max 40).");
      const skill: Skill = normalizeSkill({
        id: newId("sk"),
        name,
        description: (input.description ?? "").trim(),
        instructions: (input.instructions ?? "").trim(),
        enabled: true,
        isExample: input.isExample === true,
        createdBy: input.createdBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const all = await readJson<Skill[]>(this.storage, SKILLS_KEY, []);
      all.push(skill);
      await writeJson(this.storage, SKILLS_KEY, all);
      this.emit();
      return skill;
    });
  }

  async updateSkill(
    id: string,
    patch: { name?: string; description?: string; instructions?: string; enabled?: boolean },
  ): Promise<Skill | null> {
    return this.enqueueWrite(async () => {
      const all = await readJson<Skill[]>(this.storage, SKILLS_KEY, []);
      const s = all.find((x) => x.id === id);
      if (!s) return null;
      if (patch.name !== undefined) {
        const v = patch.name.trim();
        if (!v) throw new Error("Skill name must not be empty.");
        if (v.length > 40) throw new Error("Skill name too long (max 40).");
        s.name = v;
      }
      if (patch.description !== undefined) s.description = patch.description.trim();
      if (patch.instructions !== undefined) s.instructions = patch.instructions.trim();
      if (patch.enabled !== undefined) s.enabled = patch.enabled;
      s.updatedAt = Date.now();
      await writeJson(this.storage, SKILLS_KEY, all);
      this.emit();
      return normalizeSkill(s);
    });
  }

  async deleteSkill(id: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const all = await readJson<Skill[]>(this.storage, SKILLS_KEY, []);
      const idx = all.findIndex((s) => s.id === id);
      if (idx < 0) return false;
      all.splice(idx, 1);
      await writeJson(this.storage, SKILLS_KEY, all);
      this.emit();
      return true;
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<Skill | null> {
    return this.updateSkill(id, { enabled });
  }

  /**
   * Token-minimal index for the system prompt — the proactive note itself.
   * One line per enabled skill: name + description. Stays tiny on purpose.
   * Same pattern as the manual index (纸条机制）.
   */
  async buildSkillIndex(): Promise<string> {
    const enabled = await this.listEnabled();
    if (enabled.length === 0) return "";
    const lines = enabled.map(
      (s) => `- skill:${s.id} "${s.name}": ${s.description || "（暂无描述）"}`,
    );
    return [
      "Skills (her custom capability packs — one line each; full text via skill_read):",
      ...lines,
      "When the chat touches a skill's topic, call skill_read first, then follow its instructions.",
    ].join("\n");
  }
}
