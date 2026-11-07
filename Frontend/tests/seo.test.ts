import assert from 'node:assert/strict'
import test from 'node:test'
import { baseKeywords, createKeywords, keywordGroups, containsPrivateSeoTerms } from '../scripts/seo-keywords.mjs'

test('SEO keywords include over 100 distinct relevant phrases plus spelling variants', () => {
  assert(baseKeywords.length >= 100)
  assert(new Set(baseKeywords.map((term: string) => term.replace(/\s/g, ''))).size >= 100)
  assert.equal(new Set(baseKeywords).size, baseKeywords.length)
  assert(keywordGroups.spellings.includes('웹툰 추전'))
  assert(keywordGroups.english.includes('similar webtoons'))
  assert(baseKeywords.includes('비슷한 웹툰'))
})

test('page-specific keywords lead the list and duplicates and separators are removed', () => {
  const terms = createKeywords(['약한영웅 비슷한 웹툰', '약한영웅 비슷한 웹툰', '  작품, 비교; <태그>  ', ''])
  assert.equal(terms[0], '약한영웅 비슷한 웹툰')
  assert.equal(terms.filter((term: string) => term === terms[0]).length, 1)
  assert(terms.includes('작품 비교 태그'))
  assert(terms.length > 100)
  assert(!terms.some((term: string) => /[,;<>]/.test(term)))
})

test('public keywords discard internal recommendation details from contextual input', () => {
  const keywords = createKeywords(['웹툰 추천', '작화 25%', 'DINOv2', '그림체 비교 사례', 'public art-style snapshot'])
  assert(keywords.length >= 100)
  assert(keywords.includes('웹툰 추천'))
  assert(!keywords.some(containsPrivateSeoTerms))
  assert(!keywords.includes('DINOv2'))
})
