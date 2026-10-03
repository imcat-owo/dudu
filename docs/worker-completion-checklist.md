# Worker 完工检查块（固定模板 v1，2026-10-03）

每个建造/修复 prompt 末尾，一字不差贴这段：

---

After building: verify ALL of the following before reporting, in this order:
1. `git branch --show-current` is main (NEVER commit in detached HEAD).
2. Working tree clean except your own changes (`git status --short`).
3. `npx tsc --noEmit -p apps/mobile` — zero errors (run it yourself, do not claim without running).
4. `npx biome check` on all touched files — clean.
5. Full mobile test suite green (run it yourself).
6. Zero emoji in all touched files (grep).
7. i18n zh+en parity if you added keys.
8. Commit per logical chunk. No `git push`, no CI triggers.

Report in Chinese: what was built per requirement, file:line for key changes, commits, test results (numbers, not "all pass").
