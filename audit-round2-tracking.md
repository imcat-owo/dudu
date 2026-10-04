# 第二轮审计修复跟踪（2026-10-05）

审计报告：`audit-round2-*.md`（5 份：user / ai-use / code / xiaomeng / ui）。

流程：做 → 审 → 对齐 → 修 → 复审 → PASS 打勾 → 下一个。

## 已完成

- [x] **code P0-1**（`2026-10-05`，commit 待填）：5 个 store 的 `getSnapshot()` 返回了稳定引用，修了无限重渲染循环。文件：`api-groups/store.ts`、`api-groups/capability-store.ts`、`api-groups/dialog-model-override.ts`、`api-groups/plan-gate.ts`、`voice/store.ts`。新增回归测试 `test/snapshot-stability.test.ts`（5 个用例）。tsc 零报错、相关 76 测试全过、biome 干净。

## 待修

- code P1-1 … P1-11（见 `audit-round2-code.md`）
- user / ai-use / xiaomeng / ui 各视角条目
