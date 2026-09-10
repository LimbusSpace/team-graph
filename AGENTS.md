# Agent 操作契约

Team Graph 是 Git 驱动的轻量工作流：事实源在 `data/`，前端产物由构建生成。
所有任务操作通过 `scripts/task.mjs` 完成，它负责校验状态规则并返回短回执。

## 七条规则

1. **开始任务前先运行 `node scripts/task.mjs context <RG-xxx>`。**
   它只返回完成当前任务必需的内容（状态、验收标准、硬依赖、证据计数、允许动作）。
2. **不要读取全量项目图。** 只有跨任务规划才看 `public/data/project.json`；
   平时用 `task list --frontier` 找可开工任务。
3. **不要直接编辑 `public/data/` 和 `src/data/seed.ts`。** 它们是派生产物，
   每次状态变化都会被重建，手改会被覆盖。
4. **状态与证据只通过 task 命令修改**，不要手写 JSON：

   ```bash
   node scripts/task.mjs evidence add RG-023 --kind code --title "改动摘要" --ref <commit-sha>
   node scripts/task.mjs submit-audit RG-023
   node scripts/task.mjs status set RG-023 in_progress --actor <成员ID>
   ```

5. **不要自行批准审计或设置 done。** `evidence accept` / `complete` 需要真实审计人
   （`--reviewer`），授权以受保护的 PR review 为准；JSON 里自填的名字不构成授权。
6. **默认只查询与当前任务有关的活动**：`task context RG-xxx --include history`，
   不要读 `data/events/` 全部分片。
7. **完成后运行 `node scripts/task.mjs validate`，并留一份交接摘要**：

   ```bash
   node scripts/task.mjs handoff RG-023 --file handoff.md --actor <成员ID>
   ```

   交接模板：目标 / 已完成事项 / 涉及文件 / 测试结果 / 未解决问题 / 下一步。
   长任务务必交接，下个会话用 `task context RG-xxx --include handoff` 读取，
   不要把历史日志重新喂给模型。

## 其他约定

- commit message 里带上任务编号（如 `RG-023: fix drift detector`），
  push 后会自动归集为候选证据；一条消息只写自己负责的编号。
- `git add` / `git commit` 不写入共享任务历史；`git push` 才汇总登记。
- 写操作的短回执形如 `{ok, id, changed, next}`；被拒绝时会返回
  `HARD_DEPENDENCY_OPEN`、`NO_ACCEPTED_EVIDENCE` 这类结构化错误码，
  按提示补条件即可，不要绕过脚本直接改文件。
- 需要防并发冲突时给写命令加 `--expect-revision <task context 返回的 revision>`，
  版本不一致会被拒绝，重新读取后再试。
- `experimental/` 目录是未启用方案（含 Supabase），不要修改，也不要参考其规则。
