# 具身项目依赖台

面向五人具身操作数据项目的共享依赖、证据和进度审计工作台。当前主线是先打通 LeRobot/UMI 遥操，再完成 50 条可用于 BC 的数据采集，并显示当前真正可开工的前沿节点。

## 数据架构：事实源与发布产物分离

```text
data/                     # 事实源（直接提交，手工/脚本编辑这里）
  project.json            # 项目名、成员等低频信息
  items/RG-xxx.json       # 单个任务及其直接依赖（dependsOn）
  evidence/EV-xxx.json    # 证据与审计记录（审计人、时间、意见可追溯）
  events/YYYY-MM-DD.json  # 活动日志，按日期分片
  handoffs/RG-xxx/        # 任务交接摘要

scripts/task.mjs          # Agent / 人工统一的任务操作入口
scripts/build-data.mjs    # 校验事实源 → 生成全部发布产物

public/data/              # 派生产物，不要手工编辑
  manifest.json           # revision + 生成时间（前端轮询这个文件）
  project.json            # 前端完整视图
  status.json             # Rainmeter 摘要
  items/RG-xxx.json       # 任务详情（Agent 可按需读取）
```

- 每类信息只有一个事实源；`project.json`、`status.json`、`manifest.json` 由同一次构建生成；
- 事实源内容哈希即 `revision`，前端只在 revision 变化时重新下载整图；
- 跨任务约束（依赖环、done 门槛、审计可追溯）由 `task.mjs validate` 整体校验。

## Agent / 人工操作入口

```bash
node scripts/task.mjs context RG-023              # 只读当前任务必需的上下文
node scripts/task.mjs list --frontier             # 当前可开工的任务
node scripts/task.mjs evidence add RG-023 --kind code --title "..." --ref <sha>
node scripts/task.mjs submit-audit RG-023
node scripts/task.mjs evidence accept EV-xxx --reviewer <成员ID>
node scripts/task.mjs complete RG-023 --reviewer <成员ID>
node scripts/task.mjs validate
```

Agent 的完整约定见 [AGENTS.md](AGENTS.md)：先 `context` 再动手、不读全量图、
不改派生产物、不自行批准审计。状态规则（状态机、审计门槛、按任务类型区分的
Git 推进策略）集中在 `scripts/lib/rules.mjs`，由程序拒绝非法操作，不靠 Agent 自觉。

## GitHub-only 部署

项目不依赖独立服务器。GitHub Pages 托管网页和状态文件，GitHub Actions 把带 `RG-xxx` 的 push / PR 事件归集进事实源。

1. 将仓库 Pages 来源设置为 `Deploy from a branch`，分支选择 `gh-pages`、目录选择 `/ (root)`。
2. 推送到 `main`，等待 `Build and deploy team graph` 工作流完成。
3. 网页地址为 `https://LimbusSpace.github.io/team-graph/`。
4. Rainmeter 状态地址为 `https://LimbusSpace.github.io/team-graph/data/status.json`。

提交信息、分支名或 PR 标题中包含节点编号即可触发归集，例如：

```text
RG-032: add drift detector
```

状态推进是按任务类型受限的迁移：代码 push 让任务进入“进行中”，代码任务的 PR
合并进入“待审计”；实验、论点、决策门的合并只生成候选证据，不自动推进。
合并 PR 不等于任务完成——通过审计和标记完成仍需 `task.mjs` 里的显式人工确认。
被 concurrency 取消或漏掉的事件由每周对账（`scripts/reconcile-github.mjs`）补偿；
所有事件按“仓库 + SHA + 任务 + 动作”的业务身份去重，重放是安全的。

`rainmeter/TeamGraph.ini` 可作为 Rainmeter skin 使用。安装后将 `FeedUrl` 改成实际 Pages 地址即可。

## Polyhook Agent Hook

Codex、Claude Code、Cursor、Windsurf 执行 `git push` 后自动把本次推送的 commit
归集到关联节点。`git add` / `git commit` 不写入共享历史；Hook 失败不会阻断正常
Git 操作。安装：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\team-graph\scripts\install-polyhook.ps1" `
  -TargetRepoPath "C:\path\to\code-repo" `
  -TeamGraphPath "C:\path\to\team-graph" `
  -Agent all `
  -AutoPush
```

所有 Agent 共用一份 `scripts/team-graph-polyhook.cjs`，由 `@polyhook/sdk` 统一事件格式；
事件经 `task.mjs record-push` 受控入口落账，与 Actions 重复观察同一 commit 时自动去重。

## 本地运行

```powershell
npm install
npm run dev
```

本地开发默认读取 `public/data/project.json`；前端每 30 秒轮询一次
`data/manifest.json`，revision 变化才重新加载整图，页面隐藏时暂停轮询，
并显示最后同步时间（这是静态轮询，不是实时推送）。

## 桌面投影与开机启动

在每台 Windows 电脑运行：

```powershell
.\scripts\install-startup.ps1 -AppUrl "https://你的看板域名"
```

专用投影屏可增加 `-Kiosk`。移除开机启动：

```powershell
.\scripts\remove-startup.ps1
```

详细架构、审计规则和事件归集说明见 [docs/architecture.md](docs/architecture.md)。
