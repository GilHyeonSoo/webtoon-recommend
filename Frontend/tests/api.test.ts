import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeWebtoons, searchWebtoons } from '../src/api/webtoons.ts'

test('search encodes Korean titles and forwards an abort signal', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(String(url), 'http://localhost').searchParams.get('q'), '성장 & 사랑')
      assert.ok(init?.signal)
      controller.abort()
      assert.ok(init.signal.aborted)
      return new Response(JSON.stringify({ webtoons: [], total: 0 }), { status: 200 })
    }
    await searchWebtoons('성장 & 사랑', controller.signal)
  } finally { globalThis.fetch = original }
})
test('analysis sends the chosen titles together to the backend', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/recommendations')
      assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), { webtoonIds: ['a', 'b', 'c'], limit: 10 })
      return new Response(JSON.stringify({ selected: [], recommendations: [], catalogCount: 30, method: 'content-similarity-v1' }))
    }
    const result = await analyzeWebtoons(['a', 'b', 'c'], new AbortController().signal)
    assert.equal(result.catalogCount, 30)
  } finally { globalThis.fetch = original }
})
test('server errors reach the UI with a useful retry message', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: '다시 검색해주세요.' }), { status: 404 })
    await assert.rejects(searchWebtoons('a', new AbortController().signal), /다시 검색해주세요/)
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    await assert.rejects(searchWebtoons('a', new AbortController().signal), /서버에 연결하지 못했어요/)
  } finally { globalThis.fetch = original }
})

test('result filters send both platform and completion conditions to the backend', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        webtoonIds: ['seed'], limit: 10, preferences: { platform: 'kakao', completion: 'complete' },
      })
      return new Response(JSON.stringify({ selected: [], recommendations: [], catalogCount: 6010, method: 'content-similarity-v1-preferences' }))
    }
    await analyzeWebtoons(['seed'], new AbortController().signal, { platform: 'kakao', completion: 'complete' })
  } finally { globalThis.fetch = original }
})

test('HTML fallback responses produce an API configuration message for search and analysis', async () => {
  const original = globalThis.fetch
  try {
    for (const status of [200, 404]) {
      globalThis.fetch = async () => new Response('<!doctype html><html></html>', {
        status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
      await assert.rejects(searchWebtoons('', new AbortController().signal), /웹툰 API 연결 설정/)
      await assert.rejects(analyzeWebtoons(['seed'], new AbortController().signal), /웹툰 API 연결 설정/)
    }
  } finally { globalThis.fetch = original }
})

test('malformed JSON does not expose a parser error to the user', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(searchWebtoons('', new AbortController().signal), /올바른 웹툰 데이터를 받지 못했어요/)
  } finally { globalThis.fetch = original }
})

test('re-search sends visible recommendation IDs without changing seeds or filters', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        webtoonIds: ['seed'], limit: 10, preferences: { platform: 'naver', completion: 'ongoing' }, excludeIds: ['old-1', 'old-2'],
      })
      return new Response(JSON.stringify({ selected: [], recommendations: [], catalogCount: 6010, method: 'content-similarity-v1-preferences' }))
    }
    await analyzeWebtoons(['seed'], new AbortController().signal, { platform: 'naver', completion: 'ongoing' }, ['old-1', 'old-2'])
  } finally { globalThis.fetch = original }
})
