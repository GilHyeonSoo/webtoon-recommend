import type { ReactNode } from 'react'
import type { Webtoon } from '../api/webtoons'
import { providerLabels } from '../api/webtoons'
import { SiteFooter } from './PublicHome'
import { genres, guides, site, workPath } from './content'
import type { Editorial, GenreSlug } from './content'

export type PublicWork = { webtoon: Webtoon; editorial: Editorial }
export type RelatedWork = { work: PublicWork; reasons: string[] }
export const statusLabel = (work: Webtoon) => work.isEnd ? '완결' : work.isOnHiatus ? '휴재' : '연재 중'
export const genreName = (slug: GenreSlug) => genres.find((genre) => genre.slug === slug)!.name

export function PageLayout({ title, intro, children, crumbs = [] }: { title: string; intro: string; children: ReactNode; crumbs?: { name: string; path: string }[] }) {
  return <><header className="site-header"><a className="brand" href="/"><img src="/icon.png" width="36" height="36" alt="" />{site.name}</a></header><main className="public-page" id="main-content"><nav className="breadcrumbs" aria-label="현재 위치"><a href="/">홈</a>{crumbs.map((crumb) => <span key={crumb.path}> / <a href={crumb.path}>{crumb.name}</a></span>)}</nav><header className="public-page-heading"><h1>{title}</h1><p>{intro}</p></header>{children}</main><SiteFooter /></>
}

export function WorkCard({ work }: { work: PublicWork }) {
  const item = work.webtoon
  return <article className="public-work-card glass-panel"><a className="public-work-image" href={workPath(item.id)}><img src={item.thumbnail[0]} width="160" height="240" loading="lazy" decoding="async" referrerPolicy="no-referrer" alt={`${item.title.trim()} 표지`} /></a><div><p className="eyebrow">{genreName(work.editorial.genre)} · {providerLabels[item.provider]}</p><h2><a href={workPath(item.id)}>{item.title.trim()}</a></h2><p>{work.editorial.note}</p><a className="public-text-link" href={workPath(item.id)}>소개와 닮은 작품 보기 →</a></div></article>
}

export function WorkPage({ work, related }: { work: PublicWork; related: RelatedWork[] }) {
  const item = work.webtoon
  return <PageLayout title={`${item.title.trim()}, 비슷한 웹툰 찾기`} intro={work.editorial.note} crumbs={[{ name: '작품', path: '/webtoons' }, { name: item.title.trim(), path: workPath(item.id) }]}>
    <section className="work-overview glass-panel" aria-label="작품 정보"><img src={item.thumbnail[0]} width="200" height="300" fetchPriority="high" referrerPolicy="no-referrer" alt={`${item.title.trim()} 표지`} /><div><p className="eyebrow">{genreName(work.editorial.genre)}</p><dl><div><dt>작가</dt><dd>{item.authors.join(' · ')}</dd></div><div><dt>플랫폼</dt><dd>{providerLabels[item.provider]}</dd></div><div><dt>저장된 연재 상태</dt><dd>{statusLabel(item)}</dd></div></dl><p className="public-muted">상태는 저장된 목록 기준이며 변경될 수 있어요. 최신 연재·이용 등급·회차별 요금은 공식 플랫폼에서 확인해주세요.</p><div className="public-actions"><a className="primary-button" href={`/?seed=${encodeURIComponent(item.id)}`}>이 작품으로 맞춤 추천 →</a><a href={item.url} target="_blank" rel="noopener noreferrer">공식 플랫폼에서 보기 ↗</a></div></div></section>
    <section className="public-prose"><h2>어떤 취향과 연결될까요?</h2><p>{work.editorial.contrast}</p><p>먼저 <a href={`/genres/${work.editorial.genre}`}>{genreName(work.editorial.genre)} 추천 가이드</a>에서 같은 갈래의 이야기를 비교해보세요. 여러 작품을 함께 넣는 맞춤 추천에서는 더 다양한 특징을 종합할 수 있습니다.</p><h2>비슷한 웹툰을 고른 기준</h2><p>아래 후보는 이 사이트에 소개된 작품 중 같은 이야기 갈래와 저장된 태그를 비교해 골랐습니다. 인기 순위가 아니며, 줄거리의 전개나 재미가 같다는 의미는 아닙니다. <a href="/methodology">맞춤 추천과 공개 목록의 차이</a>도 확인할 수 있어요.</p></section>
    <div className="public-related">{related.map(({ work: other, reasons }) => <section key={other.webtoon.id}><WorkCard work={other} /><p className="comparison-note"><strong>함께 고른 이유</strong> · {reasons.join(' · ')}<br /><strong>비교할 점</strong> · {other.editorial.contrast}</p></section>)}</div>
    <p className="public-muted">작품 정보 출처: <a href={item.url} target="_blank" rel="noopener noreferrer">{providerLabels[item.provider]}</a>. 이 페이지의 소개·비교 문구는 저장된 작품 정보에 근거해 작성했습니다.</p>
  </PageLayout>
}

export function DirectoryPage({ works }: { works: PublicWork[] }) {
  return <PageLayout title="작품별 소개와 비슷한 웹툰" intro="마음에 드는 출발점을 골라보세요. 소개와 비교 기준을 마련한 작품부터 보여드립니다. 전체 카탈로그 검색은 첫 화면의 웹툰 추가에서 이용할 수 있어요." crumbs={[{ name: '작품', path: '/webtoons' }]}><nav className="genre-links" aria-label="장르별 보기">{genres.map((genre) => <a href={`/genres/${genre.slug}`} key={genre.slug}>{genre.name}</a>)}</nav><div className="public-work-grid">{works.map((work) => <WorkCard key={work.webtoon.id} work={work} />)}</div></PageLayout>
}

export function GenrePage({ slug, works }: { slug: GenreSlug; works: PublicWork[] }) {
  const genre = genres.find((entry) => entry.slug === slug)!
  return <PageLayout title={`${genre.name} 웹툰 추천`} intro={genre.intro} crumbs={[{ name: '작품', path: '/webtoons' }, { name: genre.name, path: `/genres/${slug}` }]}><section className="public-prose"><h2>{genre.question}</h2><p>작품마다 소개와 비교할 점을 함께 적었습니다. 순서는 인기나 평점 순위가 아니며, 하나의 장르 안에서도 좋아하는 설정이 다를 수 있어요. 작품을 골랐다면 맞춤 추천으로 다른 플랫폼의 후보까지 찾아보세요.</p></section><div className="public-work-grid">{works.map((work) => <WorkCard key={work.webtoon.id} work={work} />)}</div><a className="primary-button" href="/">좋아하는 작품으로 추천받기 →</a></PageLayout>
}

export function GuidePage({ slug, works }: { slug: string; works: PublicWork[] }) {
  const guide = guides.find((entry) => entry.slug === slug)!
  return <PageLayout title={guide.title} intro={guide.description} crumbs={[{ name: '작품', path: '/webtoons' }, { name: guide.kind === 'completed' ? '완결작 고르기' : '취향 찾기', path: `/guides/${slug}` }]}><section className="public-prose"><h2>{guide.kind === 'completed' ? '완결 여부와 읽고 싶은 분위기를 함께 보세요' : '장르보다 한 단계 더 구체적으로'}</h2>{guide.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<p><a href="/methodology">추천 계산 방식</a>과 <a href="/webtoons">작품별 소개</a>를 함께 살펴볼 수 있습니다.</p></section><div className="public-work-grid">{works.map((work) => <WorkCard key={work.webtoon.id} work={work} />)}</div><a className="primary-button" href="/">내 취향으로 찾아보기 →</a></PageLayout>
}

export function AboutPage() {
  return <PageLayout title="웹툰추천 서비스 소개" intro="좋아했던 이야기에서 다음으로 좋아할 이야기를 찾습니다." crumbs={[{ name: '서비스 소개', path: '/about' }]}><div className="public-prose"><h2>선택한 작품에서 출발하는 발견</h2><p>웹툰추천은 네이버와 카카오의 작품 정보를 비교해 새로운 읽을거리를 제안하는 서비스입니다. 작품을 직접 제공하는 감상 플랫폼은 아니며, 감상은 각 작품의 공식 플랫폼으로 이어집니다.</p><h2>출처와 정보의 범위</h2><p>작가·플랫폼·태그·연재 상태는 저장된 작품 목록을 사용합니다. 실시간 정보가 아니므로 상태와 이용 조건은 원문 플랫폼에서 확인해야 합니다. 공개 페이지의 소개는 작품 정보에 근거한 비교 안내이며 전체 회차를 읽은 독자 리뷰로 표시하지 않습니다.</p><h2>정보 수정과 문의</h2><p>잘못된 작품 연결이나 정보가 있다면 작품명과 해당 페이지 주소를 <a href="https://github.com/GilHyeonSoo/webtoon-recommend/issues" target="_blank" rel="noopener noreferrer">프로젝트 문의 게시판</a>에 남겨주세요. 공개 게시판에는 개인정보를 적지 마세요.</p><h2>사용하는 서체</h2><p>Paperlogy 서체를 사용합니다. <a href="/fonts/OFL.txt">서체 라이선스</a>를 확인할 수 있습니다.</p></div></PageLayout>
}

export function MethodologyPage() {
  return <PageLayout title="웹툰 추천 기준과 유사도의 의미" intro="무엇이 닮았는지 설명하고, 알 수 없는 정보는 추측하지 않습니다." crumbs={[{ name: '추천 기준', path: '/methodology' }]}><div className="public-prose"><h2>맞춤 추천은 어떻게 계산하나요?</h2><p>선택한 작품의 장르·태그·줄거리·제목·작가 특징을 비교합니다. 채널별 기본 비중은 장르 38%, 태그 30%, 줄거리 17%, 제목 10%, 작가 5%입니다. 정보가 없는 채널은 비교에서 제외하고 사용 가능한 채널의 비중을 다시 맞춥니다. 여러 작품을 선택하면 각 작품을 같은 비중으로 반영합니다.</p><h2>유사도와 필터는 다릅니다</h2><p>유사도는 특징이 겹치는 정도입니다. 재미있을 확률, 독자 평점, 작품의 품질이나 인기를 의미하지 않습니다. 플랫폼·연재 상태 필터는 후보를 좁히며 점수를 높이지 않습니다. 완결(휴재)에는 휴재 작품도 포함되고, 연재 중에서는 휴재 작품을 제외합니다.</p><h2>공개 소개의 비슷한 웹툰은요?</h2><p>공개 페이지는 소개 문구를 마련한 소규모 작품 목록에서 같은 이야기 갈래와 겹치는 태그를 기준으로 연결합니다. 개인화 추천 점수를 표시하지 않으며 인기 순위도 아닙니다. 맞춤 추천을 시작하면 더 넓은 카탈로그와 다른 비교 방식으로 결과를 받게 됩니다.</p><h2>재검색과 기록</h2><p>같은 조건의 재검색에서는 화면에 표시한 작품을 제외합니다. 필터를 변경하면 추천 이력이 초기화되어 이전 작품이 다시 나올 수 있습니다. 선택과 추천 이력은 현재 페이지의 메모리에서 관리하며 새로고침하면 유지되지 않습니다. 서버는 요청 처리에 필요한 작품 ID와 필터를 받습니다.</p><h2>정보가 적으면 추천도 제한됩니다</h2><p>장르나 줄거리 정보가 부족하면 좋은 비교 근거를 만들기 어렵습니다. 결과가 기대와 다르면 선택한 작품을 바꾸거나 서로 다른 매력의 작품을 함께 골라보세요. <a href="/guides/find-your-taste">취향을 정리하는 방법</a>도 준비했습니다.</p></div></PageLayout>
}

export function NotFoundPage() {
  return <PageLayout title="페이지를 찾을 수 없어요" intro="주소가 바뀌었거나 존재하지 않는 페이지입니다."><a className="primary-button" href="/">웹툰 추천 시작하기 →</a><a className="public-text-link" href="/webtoons">작품 목록 보기</a></PageLayout>
}
