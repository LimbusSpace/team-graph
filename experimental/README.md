# experimental/ — 未启用方案

**本目录中的方案当前未启用，默认维护流程不涉及这里。**

- Agent 不要修改本目录内容，也不要把这里的路径/规则写入 AGENTS.md 或其他默认文档；
- 这里不维护与主线可独立变化的状态规则。主线状态规则只在 `scripts/lib/rules.mjs`；
- 如需继续演进，请在独立分支上进行，避免与主线互相牵制。

## supabase/ — 未启用的在线同步方案

主线是 GitHub-only 静态架构（事实源 `data/`，派生产物 `public/data/`）。
只有在出现以下明确需求时才考虑切回 Supabase：

- 网页内直接修改任务（当前通过 GitHub 提交 + `task.mjs`）；
- 用户身份与细粒度权限（当前由 GitHub 权限 + 受保护分支承担）；
- 私有任务数据的访问控制；
- 多人高频并发编辑；
- 秒级同步。

`supabase/` 内容：

| 文件 | 说明 |
|---|---|
| `schema.sql` | 表结构（work_items / dependencies / evidence / events / profiles） |
| `seed.sql` | 由 `generate-seed-sql.ts` 从 `src/data/seed.ts` 生成的种子数据 |
| `functions/git-webhook/` | 接收 GitHub webhook 的 Edge Function |
| `generate-seed-sql.ts` | seed 生成脚本（`npx tsx experimental/supabase/generate-seed-sql.ts`） |
| `src-integration/` | 恢复时拷回 `src/` 的前端集成代码（`lib/supabase.ts`、`hooks/useAuth.ts`、`components/LoginScreen.tsx`），并重新安装 `@supabase/supabase-js` |

注意：`seed.sql` 依赖 `src/data/seed.ts` 的形状。主线 seed 已改为由
`scripts/build-data.mjs` 生成（新增 `revision` 字段），恢复使用前需要同步更新
`generate-seed-sql.ts` 与 schema。
