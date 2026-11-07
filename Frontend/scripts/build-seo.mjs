import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createElement } from 'react'
import * as seo from '../.ssg/render.js'

const { site, genres, guides, editorials, workPath, assertCatalogItem } = seo
const output = new URL('../dist/', import.meta.url)
const template = await readFile(new URL('index.html', output), 'utf8')
const catalog = JSON.parse(await readFile(new URL('../src/data/webtoons.json', import.meta.url), 'utf8'))
if (!Array.isArray(catalog)) throw new Error('Catalog must be an array')
const byId = new Map()
for (const item of catalog) {
  assertCatalogItem(item)
  if (byId.has(item.id)) throw new Error(`Duplicate catalog ID: ${item.id}`)
  byId.set(item.id, item)
}
const publicIds = new Set()
const works = editorials.map((editorial) => {
  if (publicIds.has(editorial.id) || !/^(naver|kakao|kakao_page)_[a-zA-Z0-9_-]+$/.test(editorial.id)) throw new Error('Invalid editorial identity')
  publicIds.add(editorial.id)
  const webtoon = byId.get(editorial.id)
  if (!webtoon || !webtoon.synopsis?.trim() || !webtoon.authors?.length || !webtoon.thumbnail?.length || !webtoon.tags?.length || !genres.some((genre) => genre.slug === editorial.genre)) throw new Error(`Missing public work evidence: ${editorial.id}`)
  if (editorial.note.length < 50 || editorial.contrast.length < 20) throw new Error(`Thin editorial: ${editorial.id}`)
  return { editorial, webtoon }
})
// No live API, no backend credentials, and no all-catalog ranking at request time.
const tags = (work) => new Set(work.webtoon.tags.map((tag) => tag.replace(/^#/, '').trim()))
const relatedTo = (work) => {
  const selectedTags = tags(work)
  return works.filter((candidate) => candidate !== work && candidate.editorial.genre === work.editorial.genre).map((candidate) => {
    const shared = [...tags(candidate)].filter((tag) => selectedTags.has(tag))
    const genre = genres.find((entry) => entry.slug === candidate.editorial.genre)
    return { work: candidate, shared, reasons: [`${genre.name} 갈래로 함께 소개한 작품`, ...shared.slice(0, 2).map((tag) => `겹치는 태그: ${tag}`)] }
  }).sort((a, b) => b.shared.length - a.shared.length || a.work.webtoon.id.localeCompare(b.work.webtoon.id)).slice(0, 4)
}
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const jsonLd = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
const preview = process.env.VERCEL_ENV === 'preview' || process.env.SEO_NOINDEX === 'true'
const assetHead = [...template.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="\/assets\/[^"<>]+"[^>]*>(?:<\/script>)?/g)].map(([tag]) => tag)
const styles = assetHead.filter((tag) => tag.startsWith('<link'))
const scripts = assetHead.filter((tag) => tag.startsWith('<script'))
if (!styles.length || !scripts.length) throw new Error('Missing client build assets')
const pages = []
const breadcrumb = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: '홈', path: '/' }, ...items].map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: `${site.origin}${item.path}` })) })
async function writePage({ path, title, description, component, props, home = false, noindex = false, structured = [] }) {
  if (pages.some((page) => page.path === path)) throw new Error(`Duplicate page ${path}`)
  const body = home ? seo.renderHome() : seo.renderToStaticMarkup(createElement(component, props))
  const canonical = `${site.origin}${path}`
  const robots = preview || noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'
  const schemas = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: canonical, inLanguage: 'ko' }, ...structured]
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="theme-color" content="#ffffff" />
<title>${escape(title)}</title><meta name="description" content="${escape(description)}" /><meta name="robots" content="${robots}" /><link rel="canonical" href="${escape(canonical)}" />
<meta property="og:type" content="website" /><meta property="og:locale" content="ko_KR" /><meta property="og:site_name" content="${site.name}" /><meta property="og:title" content="${escape(title)}" /><meta property="og:description" content="${escape(description)}" /><meta property="og:url" content="${escape(canonical)}" /><meta property="og:image" content="${site.origin}/social.png" /><meta property="og:image:width" content="1254" /><meta property="og:image:height" content="1254" /><meta property="og:image:alt" content="웹툰추천 아이콘" />
<meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${escape(title)}" /><meta name="twitter:description" content="${escape(description)}" /><meta name="twitter:image" content="${site.origin}/social.png" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicon.png" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /><link rel="preload" as="font" type="font/woff2" href="/fonts/Paperlogy-7Bold.woff2" crossorigin />
${styles.join('\n')}
<script type="application/ld+json">${jsonLd(schemas)}</script>
</head><body><a class="skip-link" href="${home ? '#selection-title' : '#main-content'}">본문으로 건너뛰기</a><div id="root">${body}</div>${home ? scripts.join('\n') : ''}</body></html>`
  const file = path === '/' ? 'index.html' : path === '/404' ? '404.html' : `${path.slice(1)}.html`
  const destination = new URL(file, output)
  await mkdir(new URL('.', destination), { recursive: true })
  await writeFile(destination, html)
  pages.push({ path, file, title, description, indexable: !(preview || noindex), hash: createHash('sha256').update(html).digest('hex') })
}
await writePage({ path: '/', title: site.title, description: site.description, home: true, structured: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: `${site.origin}/`, inLanguage: 'ko' }] })
await writePage({ path: '/webtoons', title: '작품별 소개와 비슷한 웹툰 | 웹툰추천', description: '웹툰별 추천 포인트와 닮은 작품을 비교해보세요. 로맨스·판타지·무협·액션·드라마·일상·스릴러에서 다음 이야기를 찾아보세요.', component: seo.DirectoryPage, props: { works }, structured: [breadcrumb([{ name: '작품', path: '/webtoons' }])] })
for (const genre of genres) {
  const path = `/genres/${genre.slug}`
  await writePage({ path, title: `${genre.name} 웹툰 추천 | 웹툰추천`, description: genre.intro, component: seo.GenrePage, props: { slug: genre.slug, works: works.filter((work) => work.editorial.genre === genre.slug) }, structured: [breadcrumb([{ name: '작품', path: '/webtoons' }, { name: genre.name, path }])] })
}
for (const guide of guides) {
  const candidates = guide.kind === 'completed' ? works.filter((work) => work.webtoon.isEnd) : genres.map((genre) => works.find((work) => work.editorial.genre === genre.slug)).filter(Boolean)
  const path = `/guides/${guide.slug}`
  await writePage({ path, title: `${guide.title} | 웹툰추천`, description: guide.description, component: seo.GuidePage, props: { slug: guide.slug, works: candidates }, structured: [breadcrumb([{ name: '작품', path: '/webtoons' }, { name: guide.title, path }])] })
}
for (const work of works) {
  const item = work.webtoon, path = workPath(item.id)
  await writePage({ path, title: `${item.title.trim()} 비슷한 웹툰 추천 | 웹툰추천`, description: work.editorial.note, component: seo.WorkPage, props: { work, related: relatedTo(work) }, structured: [breadcrumb([{ name: '작품', path: '/webtoons' }, { name: item.title.trim(), path }])] })
}
await writePage({ path: '/about', title: '서비스 소개 | 웹툰추천', description: '웹툰추천의 서비스 범위, 작품 정보 출처, 수정 요청 방법을 안내합니다.', component: seo.AboutPage, structured: [breadcrumb([{ name: '서비스 소개', path: '/about' }])] })
await writePage({ path: '/methodology', title: '추천 기준과 유사도의 의미 | 웹툰추천', description: '장르·태그·줄거리·제목·작가를 비교하는 맞춤 추천과 공개 작품 소개의 차이, 유사도와 필터의 의미를 알아보세요.', component: seo.MethodologyPage, structured: [breadcrumb([{ name: '추천 기준', path: '/methodology' }])] })
await writePage({ path: '/404', title: '페이지를 찾을 수 없어요 | 웹툰추천', description: '주소를 확인하거나 작품 목록에서 새로운 이야기를 찾아보세요.', component: seo.NotFoundPage, noindex: true })
const indexable = pages.filter((page) => page.indexable)
// Omit lastmod until actual content revision dates are maintained. Build time is not an editorial update.
await writeFile(new URL('sitemap.xml', output), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((page) => `<url><loc>${escape(`${site.origin}${page.path}`)}</loc></url>`).join('\n')}\n</urlset>\n`)
await writeFile(new URL('robots.txt', output), preview ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${site.origin}/sitemap.xml\n`)
await writeFile(new URL('../.ssg/seo-manifest.json', import.meta.url), JSON.stringify({ preview, pages, publicWorks: works.map((work) => work.webtoon.id) }, null, 2))
console.log(`SEO: ${indexable.length} indexable pages, ${works.length} editorial works; no live API requests`)
