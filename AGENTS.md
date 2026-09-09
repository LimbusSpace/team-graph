# Team Graph Codex Hook

这是 Codex lifecycle hook，不是 Git 原生 hook。官方支持的配置位置包括：

- `~/.codex/hooks.json`
- `~/.codex/config.toml`
- `<项目根目录>/.codex/hooks.json`
- `<项目根目录>/.codex/config.toml`

本项目提供的是项目级 `.codex/hooks.json` 模板。Team Graph 的模板位于本仓库 `.codex/hooks.json`，真正生效的位置是被接入的代码仓库根目录下的 `.codex/hooks.json`。

不要把它放到 `.git/hooks`：那里是 Git 原生 Hook，不能接收 Codex 的 `PostToolUse` 生命周期事件。

全局配置 `~/.codex/hooks.json` 也能生效，但会影响该用户使用 Codex 的所有项目；团队图谱建议使用项目级配置，并在 Codex 中通过 `/hooks` 审查、信任该项目的 Hook。

## 安装到代码仓库

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\team-graph\scripts\install-codex-hook.ps1" `
  -TargetRepoPath "C:\path\to\code-repo" `
  -TeamGraphPath "C:\path\to\team-graph" `
  -DefaultNode "RG-032" `
  -AutoPush
```

不传 `-AutoPush` 时只更新并提交 Team Graph 状态，不推送状态仓库。`-AutoPush` 是显式开启的外部写操作，会把状态仓库推送到 GitHub Pages 的源仓库。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\team-graph\scripts\install-codex-hook.ps1" `
  -TargetRepoPath "C:\path\to\code-repo" `
  -Uninstall
```

安装后需要在 Codex 中使用 `/hooks` 审查并信任新的 hook。Hook 监听 `PostToolUse` 的 `Bash`，观察 `git add`、`git commit`、`git push`；节点编号优先从命令、当前分支或最近提交信息读取，也可以用 `-DefaultNode` 指定。它不会自动推送代码仓库，只会按 `autoPush` 设置推送 Team Graph 状态仓库。

安装器写入的 `.codex/team-graph.local.json` 只保存本机路径和推送开关，并自动加入 Git 的 `.git/info/exclude`，不会把个人绝对路径提交给团队。`.codex/hooks.json` 和 `.codex/hooks/team-graph-post-tool.cjs` 可以提交到目标代码仓库，供其他 Agent 复用。
