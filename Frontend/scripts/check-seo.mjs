import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
const dist = new URL('../dist/', import.meta.url)
const { pages, publicWorks, preview, artCalibration, artExamples } = JSON.parse(await readFile(new URL('../.ssg/seo-manifest.json', import.meta.url), 'utf8'))
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
assert(!config.rewrites.some((rule) => rule.source === '/(.*)'), 'Catch-all rewrite would hide 404s')
assert(config.rewrites.some((rule) => rule.source === '/api/:path*' && rule.destination.endsWith('/api/:path*')))
assert(config.cleanUrls === false && config.trailingSlash === false)
assert(config.rewrites.some((rule) => rule.source === '/webtoons/:id' && rule.destination === '/webtoons/:id.html'))
assert(!config.redirects.some((rule) => rule.source.includes('google')), 'Verification HTML must retain its original URL')
assert(config.headers.some((rule) => rule.source === '/api/:path*' && rule.headers.some((header) => header.key === 'X-Robots-Tag' && header.value === 'noindex')))
const titles = new Set(), descriptions = new Set(), keywordSets = new Set(), allPaths = new Set(pages.map((page) => page.path)), inLinks = new Map()
for (const page of pages) {
  const html = await readFile(new URL(page.file, dist), 'utf8')
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${page.path}: one visible h1 required`)
  assert(html.includes(`href="https://webtoonrecommend.site${page.path}"`), `${page.path}: canonical missing`)
  assert(html.includes('<meta property="og:image"'), `${page.path}: OG missing`)
  const keywordTags = [...html.matchAll(/<meta name="keywords" content="([^"]*)"/g)]
  assert.equal(keywordTags.length, 1, `${page.path}: exactly one keywords tag required`)
  const keywords = keywordTags[0][1].split(', ').filter(Boolean)
  assert(keywords.length >= 100 && new Set(keywords).size === keywords.length, `${page.path}: at least 100 unique keywords required`)
  assert.equal(keywords.length, page.keywordCount)
  assert(!keywordSets.has(keywordTags[0][1]), `${page.path}: page-specific keywords required`)
  keywordSets.add(keywordTags[0][1])
  const body = html.split('<body>')[1]
  assert(!body.includes('웹툰 추전') && !body.includes('웹툰 추쳔'), `${page.path}: spelling keywords must stay in metadata`)
  assert(!titles.has(page.title), `${page.path}: duplicate title`); titles.add(page.title)
  assert(!descriptions.has(page.description), `${page.path}: duplicate description`); descriptions.add(page.description)
  assert.equal(html.includes('content="noindex, follow"'), !page.indexable)
  const schemas = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)[1])
  assert(schemas.every((schema) => schema['@context'] === 'https://schema.org'))
  assert(!html.includes('AggregateRating') && !html.includes('SearchAction'), 'No invented rich results')
  if (page.path !== '/') assert(!/<script[^>]+src=/.test(html), `${page.path}: public pages need no JS runtime`)
  if (page.path.startsWith('/webtoons/')) {
    const id = page.path.split('/').pop()
    assert(page.artMatches.length > 0 && page.artMatches.length <= 4)
    assert.equal(new Set(page.artMatches.map((match) => match.id)).size, page.artMatches.length)
    assert(body.includes('그림체 특징으로 함께 비교할 웹툰'))
    for (let i = 0; i < page.artMatches.length; i++) {
      const match = page.artMatches[i]
      assert(publicWorks.includes(match.id) && match.id !== id)
      assert(Number.isFinite(match.cosine) && match.cosine >= -1 && match.cosine <= 1)
      assert.equal(match.similar, match.cosine >= artCalibration.similarThreshold)
      assert(body.includes(`data-art-related="${match.id}" data-art-similar="${String(match.similar)}"`))
      if (i) assert(page.artMatches[i - 1].cosine >= match.cosine)
    }
  }
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.startsWith('/') || href.startsWith('//')) continue
    const target = new URL(href.replaceAll('&amp;', '&'), 'https://webtoonrecommend.site')
    if (allPaths.has(target.pathname)) {
      if (target.pathname !== page.path) inLinks.set(target.pathname, (inLinks.get(target.pathname) ?? 0) + 1)
    } else {
      assert(!target.pathname.startsWith('/api'), 'Public links must not crawl raw APIs')
      await stat(new URL(target.pathname.slice(1), dist)).catch(() => { throw new Error(`${page.path}: broken link ${href}`) })
    }
  }
  for (const [, src] of html.matchAll(/(?:src|href)="(\/(?:assets|fonts)\/[^"<>]+)"/g)) await stat(new URL(src.slice(1), dist))
}
for (const page of pages.filter((page) => page.indexable && page.path !== '/')) assert(inLinks.get(page.path), `Orphan ${page.path}`)
const sitemap = await readFile(new URL('sitemap.xml', dist), 'utf8')
assert(sitemap.startsWith('<?xml') && sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'))
assert.equal((sitemap.match(/<loc>/g) ?? []).length, pages.filter((page) => page.indexable).length)
assert(!sitemap.includes('<lastmod>') && !sitemap.includes('?seed=') && !sitemap.includes('/404'))
const robots = await readFile(new URL('robots.txt', dist), 'utf8')
assert(preview ? robots.includes('Disallow: /') : robots.includes('Sitemap: https://webtoonrecommend.site/sitemap.xml'))
assert.equal(publicWorks.length, 30)
assert.equal(new Set(publicWorks).size, publicWorks.length)
const home = await readFile(new URL('index.html', dist), 'utf8')
assert(home.includes('평소에 즐겨보는 웹툰을 선택해주세요.') && home.includes('다음 웹툰을 찾는 세 가지 방법'))
assert(home.includes('"@type":"WebSite"'))
assert(home.includes('그림체가 비슷한 웹툰도 찾을 수 있나요?') && home.includes('웹툰 회차 전체를 분석하나요?'))
assert(home.includes('그림체 특징') && home.includes('/guides/similar-art-style'))
assert(/name="naver-site-verification" content="[a-f0-9]{40}"/.test(home))
const methodology = await readFile(new URL('methodology.html', dist), 'utf8')
assert(methodology.includes('내용 정보 75% + 작화 25%'))
for (const weight of ['28.5%', '22.5%', '12.75%', '7.5%', '3.75%', '25%']) assert(methodology.includes(weight))
assert(methodology.includes('텍스트 점수를 100%'))
const artGuide = await readFile(new URL('guides/similar-art-style.html', dist), 'utf8')
assert(artGuide.includes('실제 비교 사례') && artExamples.length > 0)
for (const pair of artExamples) assert(pair.first !== pair.second && pair.cosine >= artCalibration.similarThreshold)
await stat(new URL('data/art-style-public.json', dist)).then(() => { throw new Error('Build-only vectors must not be published') }, (error) => { if (error.code !== 'ENOENT') throw error })
console.log(`SEO checks passed: ${pages.length} HTML documents, ${publicWorks.length} works, metadata, links, sitemap, preview policy and routing`)
