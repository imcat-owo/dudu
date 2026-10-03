# Reviewer Checklist（固定版 v1，2026-10-03）

每次派 reviewer，按这个来，不重新发明。Reviewer 只审不改、不提交。

## 身份钉死（prompt 开头必须有）
"You are FRESH — review only, no code changes. Read actual code. Grade P0-P3 with file:line evidence. Do NOT fix, do NOT commit."

## 分级标准
- **P0**：blocker。不修不能打勾：数据丢、崩溃、安全问题、核心功能完全不可用。
- **P1**：严重。功能坏了但有 workaround，或大面积影响：tsc 报错、主要流程走不通。
- **P2**：中等。边缘 case、文案错误、缺手册/纸条、小功能缺失。
- **P3**：小。排版、空格、冠词、非关键 nit。可顺手修，不 blocker。

## 证据标准
- 每个 P 必须带 file:line。
- "跑过"必须亲手跑（tsc/biome/测试），不许信 worker 的"零报错"。
- 结论只有 PASS 或 FAIL，不许"基本通过"。

## 必须查的项（每次）
1. tsc --noEmit 亲手跑
2. biome 亲手跑
3. 测试亲手跑（全量）
4. 零 emoji（grep）
5. i18n 中英对齐（如有新 key）
6. 工具名无重复（如有新工具）
7. 需求逐项对上（对照用户原话）
