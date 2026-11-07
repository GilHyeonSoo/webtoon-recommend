import { genres, guides } from './content'

export function PublicHome() {
  return <section className="public-intro" aria-labelledby="discover-title">
    <div className="public-section-heading"><p className="eyebrow">좋아하는 이야기에서 시작하세요</p><h2 id="discover-title">다음 웹툰을 찾는 세 가지 방법</h2><p>좋아했던 작품으로 취향을 비교하거나, 장르와 읽고 싶은 분위기부터 살펴보세요.</p></div>
    <ol className="how-it-works"><li><strong>01 · 좋아하는 웹툰 선택</strong><p>한 작품부터 최대 세 작품까지 함께 선택할 수 있어요.</p></li><li><strong>02 · 닮은 특징 비교</strong><p>장르·태그·줄거리 등의 정보를 바탕으로 유사한 후보를 찾아요.</p></li><li><strong>03 · 조건에 맞춰 발견</strong><p>네이버·카카오와 연재 상태를 고르고 새로운 작품을 만나보세요.</p></li></ol>
    <nav className="genre-links" aria-label="장르별 웹툰 추천">{genres.map((genre) => <a key={genre.slug} href={`/genres/${genre.slug}`}>{genre.name} <span aria-hidden="true">↗</span></a>)}</nav>
    <div className="guide-links">{guides.map((guide) => <a className="glass-panel" href={`/guides/${guide.slug}`} key={guide.slug}><h3>{guide.title}</h3><p>{guide.description}</p><span>가이드 읽기 →</span></a>)}</div>
    <div className="public-faq"><h2>추천하기 전에 궁금한 점</h2><details><summary>웹툰 하나만 골라도 추천받을 수 있나요?</summary><p>네. 한 작품만 선택해도 분석할 수 있어요. 서로 다른 매력의 작품을 함께 고르면 그 특징을 종합해서 비교합니다.</p></details><details><summary>유사도 퍼센트가 높으면 더 재미있나요?</summary><p>유사도는 선택한 작품과 후보를 비교할 때 참고하는 안내예요. 재미있을 확률이나 작품의 품질 점수는 아닙니다. <a href="/methodology">추천 결과 안내 보기</a></p></details><details><summary>무료로 모든 회차를 볼 수 있나요?</summary><p>이 사이트는 작품을 찾아주는 추천 서비스예요. 실제 감상과 회차별 이용 조건은 각 작품의 공식 플랫폼에서 확인해주세요.</p></details></div>
    <a className="public-text-link" href="/webtoons">작품별 소개와 비슷한 이야기 둘러보기 →</a>
  </section>
}

export function SiteFooter() {
  return <footer className="public-footer"><a href="/">웹툰추천</a><nav aria-label="사이트 안내"><a href="/webtoons">작품 둘러보기</a><a href="/methodology">추천 안내</a><a href="/about">서비스 소개</a></nav><p>작품의 권리는 각 권리자에게 있습니다. 감상은 공식 플랫폼에서 이어집니다.</p></footer>
}
