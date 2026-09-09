# 具身项目依赖台

面向四人具身操作数据项目的共享依赖、证据和进度审计工作台。它借鉴 Prove2Me 的任务分解方式，把研究主张拆成可验证节点，并显示当前真正可开工的前沿节点。

## GitHub-only 部署

项目不依赖独立服务器。GitHub Pages 托管网页和状态文件，GitHub Actions 根据带有 `RG-xxx` 的 push / PR 更新状态。

1. 将仓库 Pages 来源设置为 `Deploy from a branch`，分支选择 `gh-pages`、目录选择 `/ (root)`。
2. 推送到 `main`，等待 `Build and deploy team graph` 工作流完成。
3. 网页地址为 `https://LimbusSpace.github.io/team-graph/`。
4. Rainmeter 状态地址为 `https://LimbusSpace.github.io/team-graph/data/status.json`。

提交信息、分支名或 PR 标题中包含节点编号即可触发归集，例如：

```text
RG-032: add drift detector
```

push 会将节点推进到“进行中”并生成待审代码证据；合并 PR 会将节点推进到“待审计”。通过审计和标记完成仍需在 `public/data/project.json` 中提交明确修改，避免仅凭代码推送误判实验完成。

`rainmeter/TeamGraph.ini` 可作为 Rainmeter skin 使用。安装后将 `FeedUrl` 改成实际 Pages 地址即可。

## 本地运行

```powershell
npm install
npm run dev
```

本地开发默认读取 `public/data/project.json`，每 30 秒刷新一次。

## 团队实时模式

1. 创建 Supabase 项目。
2. 在 SQL Editor 依次执行 `supabase/schema.sql` 和 `supabase/seed.sql`。
3. 在 Supabase Authentication 创建四名团队成员。
4. 把 `team_members.user_id` 更新为对应 Auth 用户 ID，并填写各自的 `git_emails`。
5. 复制 `.env.example` 为 `.env.local`，填写 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
6. 运行 `npm run build`，将 `dist/` 部署到团队可访问的 HTTPS 地址。

## 桌面投影与开机启动

在每台 Windows 电脑运行：

```powershell
.\scripts\install-startup.ps1 -AppUrl "https://你的看板域名"
```

专用投影屏可增加 `-Kiosk`。移除开机启动：

```powershell
.\scripts\remove-startup.ps1
```

详细架构、审计规则和 Git Webhook 说明见 [docs/architecture.md](docs/architecture.md)。
