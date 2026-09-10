#!/usr/bin/env node
import { loadFacts } from './lib/store.mjs'
import { rebuildDerived } from './lib/derived.mjs'
import { validateGraph } from './lib/rules.mjs'
import { repoRoot } from './lib/paths.mjs'

/**
 * 发布数据构建：data/（事实源）→ public/data/* + src/data/seed.ts（派生产物）。
 *
 * - 校验不过不写任何文件（坏数据到不了前端）；
 * - --check：比较磁盘上的派生产物与重新生成结果，CI 用来保证派生产物没有过期；
 * - project.json / status.json / manifest.json 由同一次构建生成，revision 口径一致。
 */

const root = repoRoot()
const check = process.argv.includes('--check')

let facts
try {
  facts = loadFacts(root)
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: 'FACTS_UNREADABLE', message: String(error.message) }, null, 2))
  process.exit(1)
}

const validation = validateGraph(facts)
if (!validation.ok) {
  console.error(JSON.stringify({
    ok: false,
    code: 'GRAPH_INVALID',
    errors: validation.errors,
    warnings: validation.warnings,
  }, null, 2))
  process.exit(1)
}

const result = rebuildDerived(root, { facts, check })

if (check) {
  if (result.changed.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: 'DERIVED_STALE',
      message: '派生产物与事实源不一致，请运行 node scripts/build-data.mjs 后提交。',
      stale: result.changed,
    }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, check: true, revision: result.revision }))
} else {
  console.log(JSON.stringify({
    ok: true,
    revision: result.revision,
    items: facts.items.length,
    evidence: facts.evidence.length,
    events: facts.events.length,
    changed: result.changed,
  }, null, 2))
}
