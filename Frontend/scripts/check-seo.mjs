import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { containsPrivateSeoTerms } from './seo-keywords.mjs'
const dist = new URL('../dist/', import.meta.url)
const { pages, publicWorks, preview } = JSON.parse(await readFile(new URL('../.ssg/seo-manifest.json', import.meta.url), 'utf8'))
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
  assert(!containsPrivateSeoTerms(html), `${page.path}: internal recommendation details must not be published`)
  assert(!Object.hasOwn(page, 'artMatches'), `${page.path}: no internal comparison data in page metadata`)
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${page.path}: one visible h1 required`)
  assert(html.includes(`href="https://webtoonrecommend.site${page.path}"`), `${page.path}: canonical missing`)
  assert(html.includes('<meta property="og:image"'), `${page.path}: OG missing`)
  const keywordTags = [...html.matchAll(/<meta name="keywords" content="([^"]*)"/g)]
  assert.equal(keywordTags.length, 1)
  const keywords = keywordTags[0][1].split(', ').filter(Boolean)
  assert(keywords.length >= 100 && new Set(keywords).size === keywords.length, `${page.path}: at least 100 unique keywords required`)
  assert.equal(keywords.length, page.keywordCount)
  assert(!keywordSets.has(keywordTags[0][1]), `${page.path}: page-specific keywords required`)
  keywordSets.add(keywordTags[0][1])
  const body = html.split('<body>')[1]
  assert(!body.includes('웹툰 추전') && !body.includes('웹툰 추쳔'))
  assert(!titles.has(page.title), `${page.path}: duplicate title`); titles.add(page.title)
  assert(!descriptions.has(page.description), `${page.path}: duplicate description`); descriptions.add(page.description)
  assert.equal(html.includes('content="noindex, follow"'), !page.indexable)
  const schemas = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)[1])
  assert(schemas.every((schema) => schema['@context'] === 'https://schema.org'))
  assert(!html.includes('AggregateRating') && !html.includes('SearchAction'), 'No invented rich results')
  if (page.path !== '/') assert(!/<script[^>]+src=/.test(html), `${page.path}: public pages need no JS runtime`)
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
assert(/name="naver-site-verification" content="[a-f0-9]{40}"/.test(home))
const withdrawn = '/guides/similar-art-style'
assert(!pages.some((page) => page.path === withdrawn))
assert(!sitemap.includes(withdrawn))
await stat(new URL('guides/similar-art-style.html', dist)).then(() => { throw new Error('Withdrawn guide must not be generated') }, (error) => { if (error.code !== 'ENOENT') throw error })
await stat(new URL('data/art-style-public.json', dist)).then(() => { throw new Error('Internal vectors must not be published') }, (error) => { if (error.code !== 'ENOENT') throw error })
for (const path of [withdrawn, `${withdrawn}.html`]) {
  assert(config.headers.some((rule) => rule.source === path && rule.headers.some((header) => header.key === 'X-Robots-Tag' && header.value.includes('noindex'))))
}
console.log(`SEO checks passed: ${pages.length} HTML documents, ${publicWorks.length} works, metadata, links, sitemap, preview policy and routing`)
