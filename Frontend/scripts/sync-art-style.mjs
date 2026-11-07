import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { editorials } from '../src/seo/content.ts'
import { parsePublicArt } from './art-style-related.mjs'

const source = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../Backend/data/art-style.json', import.meta.url))
const destination = new URL('../data/art-style-public.json', import.meta.url)
const full = JSON.parse(await readFile(source, 'utf8'))
const ids = editorials.map((entry) => entry.id).sort()
parsePublicArt(full, ids)
const snapshot = { ...full, items: Object.fromEntries(ids.map((id) => [id, full.items[id]])) }
await mkdir(new URL('.', destination), { recursive: true })
const temporary = new URL(destination.href + '.tmp')
await writeFile(temporary, JSON.stringify(snapshot) + '\n')
await rename(temporary, destination)
console.log(`Public art snapshot: ${ids.length} works, ${snapshot.dimensions} dimensions; no model or image download`)
