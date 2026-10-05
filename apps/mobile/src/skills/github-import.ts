/**
 * Skill GitHub import — PURE module (no React Native imports).
 *
 * D11: Paste a GitHub URL, get a skill. Someone else's skill, ready to use.
 *
 * Accepted formats:
 * - https://github.com/owner/repo/blob/main/skills/foo/SKILL.md
 * - https://github.com/owner/repo/tree/main/skills/foo (tries SKILL.md inside)
 * - https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md
 *
 * The markdown becomes the skill instructions; the name defaults to the
 * folder/file name. She (or the AI) can rename after import.
 */

import type { SkillAuthor, SkillStore } from "./store";

function toRawUrl(url: string): string {
  const u = url.trim();
  // Already raw.
  if (u.startsWith("https://raw.githubusercontent.com/")) return u;
  const m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/([^/]+)\/(.+)$/);
  if (!m) throw new Error("Not a GitHub file/folder URL");
  const [, owner, repo, kind, branch, path] = m;
  const cleanPath = path.replace(/\/$/, "");
  const filePath = kind === "blob" ? cleanPath : `${cleanPath}/SKILL.md`;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function nameFromUrl(rawUrl: string): string {
  const parts = rawUrl.split("/");
  const file = parts[parts.length - 1] ?? "";
  const folder = parts[parts.length - 2] ?? "";
  if (/^SKILL\.md$/i.test(file) && folder) return folder;
  return file.replace(/\.md$/i, "") || "imported-skill";
}

export async function importSkillFromGithub(
  store: SkillStore,
  url: string,
  opts?: { name?: string; createdBy?: SkillAuthor },
): Promise<{ id: string; name: string }> {
  const rawUrl = toRawUrl(url);
  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(
      `Couldn't fetch the skill (HTTP ${res.status}). Check the URL — it should point at a SKILL.md file or a folder containing one.`,
    );
  }
  const markdown = await res.text();
  if (!markdown.trim()) throw new Error("The file was empty.");
  // Strip frontmatter for the description (first line or two).
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  const name = (opts?.name ?? "").trim() || nameFromUrl(rawUrl);
  const skill = await store.createSkill({
    name,
    description: firstLine.replace(/^#+\s*/, "").slice(0, 120) || `Imported from ${url}`,
    instructions: markdown,
    createdBy: opts?.createdBy ?? "her",
  });
  return { id: skill.id, name: skill.name };
}

/** For tests. */
export const __githubImport = { toRawUrl, nameFromUrl };
