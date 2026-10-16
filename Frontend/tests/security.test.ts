import assert from 'node:assert/strict'
import test from 'node:test'
import { searchWebtoons, analyzeWebtoons } from '../src/api/webtoons.ts'
import { assertCatalogItem } from '../src/lib/catalogValidation.ts'
import { readFile } from 'node:fs/promises'

test('API boundary rejects hostile URLs, wrong shapes and invalid recommendation scores', async () => {
  const original = globalThis.fetch
  const item = JSON.parse(await readFile(new URL('../src/data/webtoons.json', import.meta.url), 'utf8'))[0]
  try {
    for (const url of ['javascript:alert(1)', 'https://phishing.invalid/']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ webtoons: [{ ...item, url }], total: 1 }))
      await assert.rejects(searchWebtoons('test', new AbortController().signal), /올바른 웹툰 데이터/)
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ webtoons: [{ ...item, authors: 'wrong' }], total: 1 }))
    await assert.rejects(searchWebtoons('test', new AbortController().signal), /올바른 웹툰 데이터/)
    globalThis.fetch = async () => new Response(JSON.stringify({ selected: [item], recommendations: [{ webtoon: item, similarity: 10, reasons: [] }], catalogCount: 6010, method: 'test' }))
    await assert.rejects(analyzeWebtoons([item.id], new AbortController().signal), /올바른 웹툰 데이터/)
  } finally { globalThis.fetch = original }
})

test('every bundled catalog item is compatible with the client schema', async () => {
  const items = JSON.parse(await readFile(new URL('../src/data/webtoons.json', import.meta.url), 'utf8'))
  items.forEach(assertCatalogItem)
})
