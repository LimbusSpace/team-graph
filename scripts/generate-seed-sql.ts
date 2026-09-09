import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { seedSnapshot } from '../src/data/seed'

function sql(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `array[${value.map(sql).join(', ')}]::text[]`
  return `'${String(value).replaceAll("'", "''")}'`
}

const lines: string[] = [
  '-- Generated from src/data/seed.ts. Re-run npm run seed:generate after changing the graph.',
  'begin;',
  '',
]

for (const item of seedSnapshot.items) {
  const initialStatus = item.status === 'done' ? 'review' : item.status
  lines.push(
    `insert into public.work_items (id, title, summary, type, phase, status, owner_ids, acceptance_criteria, weight, lane, updated_at) values (${[
      item.id,
      item.title,
      item.summary,
      item.type,
      item.phase,
      initialStatus,
      item.ownerIds,
      item.acceptanceCriteria,
      item.weight,
      item.lane,
      item.updatedAt,
    ].map(sql).join(', ')}) on conflict (id) do update set title = excluded.title, summary = excluded.summary, type = excluded.type, phase = excluded.phase, owner_ids = excluded.owner_ids, acceptance_criteria = excluded.acceptance_criteria, weight = excluded.weight, lane = excluded.lane;`,
  )
}

lines.push('')
for (const dependency of seedSnapshot.dependencies) {
  lines.push(
    `insert into public.dependencies (source_id, target_id, kind) values (${sql(dependency.source)}, ${sql(dependency.target)}, ${sql(dependency.kind)}) on conflict (source_id, target_id) do update set kind = excluded.kind;`,
  )
}

lines.push('')
for (const evidence of seedSnapshot.evidence) {
  lines.push(
    `insert into public.evidence (id, work_item_id, actor_id, title, kind, url, accepted, created_at) values (${[
      evidence.id,
      evidence.workItemId,
      evidence.actorId,
      evidence.title,
      evidence.kind,
      evidence.url,
      false,
      evidence.createdAt,
    ].map(sql).join(', ')}) on conflict (id) do update set title = excluded.title, url = excluded.url, accepted = excluded.accepted;`,
  )
}

lines.push('', '-- Accept seed evidence through the normal audit trigger.')
for (const evidence of seedSnapshot.evidence.filter((entry) => entry.accepted)) {
  lines.push(`update public.evidence set accepted = true where id = ${sql(evidence.id)} and accepted = false;`)
}

lines.push('', '-- Apply completed statuses only after accepted evidence exists.')
for (const item of seedSnapshot.items) {
  lines.push(`update public.work_items set status = ${sql(item.status)}, updated_at = ${sql(item.updatedAt)} where id = ${sql(item.id)};`)
}

lines.push('', 'commit;', '')

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(currentDirectory, '../supabase/seed.sql')
writeFileSync(outputPath, lines.join('\n'), 'utf8')
console.log(`Generated ${outputPath}`)
