import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 仓库根目录。测试和工具可通过 TEAM_GRAPH_ROOT 指到临时目录。 */
export function repoRoot() {
  if (process.env.TEAM_GRAPH_ROOT) return resolve(process.env.TEAM_GRAPH_ROOT)
  return resolve(here, '..', '..')
}

export const DATA_DIR = 'data'
export const ITEMS_DIR = 'data/items'
export const EVIDENCE_DIR = 'data/evidence'
export const EVENTS_DIR = 'data/events'
export const HANDOFFS_DIR = 'data/handoffs'
export const PUBLIC_DATA_DIR = 'public/data'
export const PUBLIC_ITEMS_DIR = 'public/data/items'
export const SEED_FILE = 'src/data/seed.ts'
