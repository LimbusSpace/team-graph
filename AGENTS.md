# Team Graph Polyhook

这是基于 `polyhook` 的跨 Agent Hook，不是 Git 原生 hook。业务脚本只写一份，`@polyhook/sdk` 负责适配不同 Agent 的 stdin/stdout 格式。目前支持 Codex、Claude Code、Cursor 和 Windsurf。

安装前请在 Team Graph 仓库执行一次 `npm install`，因为共享脚本从 Team Graph 的依赖中加载 `@polyhook/sdk`。

各 Agent 的项目级配置位置是：

- Codex：`<项目根目录>/.codex/hooks.json`
- Claude Code：`<项目根目录>/.claude/settings.json`
- Cursor：`<项目根目录>/.cursor/hooks.json`
- Windsurf：`<项目根目录>/.windsurf/hooks.json`

全局配置也可以使用，但会影响该用户的所有项目。团队图谱默认安装项目级配置。

不要把它放到 `.git/hooks`：那里是 Git 原生 Hook，不能接收各 Agent 的生命周期事件。

共享业务脚本会被安装到 `<项目根目录>/.team-graph/hooks/team-graph-polyhook.cjs`。各 Agent 配置只负责在工具执行后调用它。

## 安装到代码仓库

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\team-graph\scripts\install-polyhook.ps1" `
  -TargetRepoPath "C:\path\to\code-repo" `
  -TeamGraphPath "C:\path\to\team-graph" `
  -DefaultNode "RG-032" `
  -Agent all `
  -AutoPush
```

`-Agent` 可以是 `all`、`codex`、`claude-code`、`cursor` 或 `windsurf`。不传 `-AutoPush` 时只更新并提交 Team Graph 状态，不推送状态仓库。`-AutoPush` 是显式开启的外部写操作，会把状态仓库推送到 GitHub Pages 的源仓库。

如果目标仓库已有对应 Agent 配置，安装器会拒绝覆盖，需人工把对应配置合并到现有 hooks。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\team-graph\scripts\install-polyhook.ps1" `
  -TargetRepoPath "C:\path\to\code-repo" `
  -Agent all `
  -Uninstall
```

安装 Codex 配置后，需要在 Codex 中使用 `/hooks` 审查并信任新的 hook。所有适配器都会在 Agent 执行 shell 命令后调用 polyhook；脚本只处理包含 `git add`、`git commit` 或 `git push` 的 Bash 事件。节点编号优先从命令、当前分支或最近提交信息读取，也可以用 `-DefaultNode` 指定。

安装器写入的 `.team-graph/team-graph.local.json` 只保存本机路径和推送开关，并自动加入 Git 的 `.git/info/exclude`，不会把个人绝对路径提交给团队。

项目地址：<https://github.com/polyhook/polyhook>。polyhook 的统一事件会把不同工具归一化为 `event.tool`、`event.input` 和 `event.caller`，Team Graph 不再读取某个 Agent 私有的 `tool_input` 字段。
