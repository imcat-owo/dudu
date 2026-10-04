# 嘟嘟视频动画说明（2026-10-04 更新）

## 决定（她 2026-10-04 定的）
人物视频方案砍掉——定位太难搞，不做了。
App 里用现有的 4 个穹妹视频（idle/working/making_something/milestone_level_up），简单圆形头像展示，不做人物定位。

## 当前实现
- **任务小伙伴**：圆形 Sora 视频头像，running→working.mp4，stuck→idle.mp4，done→milestone_level_up.mp4
- **桌宠**：AI 状态视频（同上 4 个）+ 触摸互动（用现有视频占位）
- **环境**：空状态/DJ/知识库用 idle/making_something 占位

## 硬规则（保留）
- 圆形裁切，无白边
- 切换交叉淡化，禁止硬切
- 零 emoji
