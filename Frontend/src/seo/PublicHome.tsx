import { genres, guides } from './content'

export function PublicHome() {
  return <section className="public-intro" aria-labelledby="discover-title">
    <div className="public-section-heading"><p className="eyebrow">좋아하는 이야기와 그림체에서 시작하세요</p><h2 id="discover-title">다음 웹툰을 찾는 세 가지 방법</h2><p>좋아했던 작품의 이야기와 그림체를 함께 비교해 취향에 맞는 웹툰을 찾아보세요.</p></div>
    <ol className="how-it-works"><li><strong>01 · 좋아하는 웹툰 선택</strong><p>한 작품부터 최대 세 작품까지 함께 선택할 수 있어요.</p></li><li><strong>02 · 이야기와 그림체 비교</strong><p>장르·태그·줄거리와 썸네일의 시각적 특징을 함께 비교해요.</p></li><li><strong>03 · 조건에 맞춰 발견</strong><p>네이버·카카오와 연재 상태를 고르고 새로운 작품을 만나보세요.</p></li></ol>
    <nav className="genre-links" aria-label="장르별 웹툰 추천">{genres.map((genre) => <a key={genre.slug} href={`/genres/${genre.slug}`}>{genre.name} <span aria-hidden="true">↗</span></a>)}</nav>
    <div className="guide-links">{guides.map((guide) => <a className="glass-panel" href={`/guides/${guide.slug}`} key={guide.slug}><h3>{guide.title}</h3><p>{guide.description}</p><span>가이드 읽기 →</span></a>)}</div>
    <div className="public-faq"><h2>추천하기 전에 궁금한 점</h2>
      <details><summary>웹툰 하나만 골라도 추천받을 수 있나요?</summary><p>네. 한 작품만 선택해도 분석할 수 있어요. 서로 다른 매력의 작품을 함께 고르면 그 특징을 종합해서 비교합니다.</p></details>
      <details><summary>그림체가 비슷한 웹툰도 찾을 수 있나요?</summary><p>네. 작화 데이터가 있으면 내용 정보 75%와 썸네일의 그림체 특징 25%를 함께 반영합니다. <a href="/guides/similar-art-style">그림체로 웹툰을 찾는 방법과 비교 사례</a>도 확인해보세요.</p></details>
      <details><summary>웹툰 회차 전체를 분석하나요?</summary><p>현재 작화 분석은 저장된 표지·썸네일을 사용합니다. 모든 회차와 컷을 분석하는 방식은 아니며, 실제 회차의 그림체와 차이가 있을 수 있어요.</p></details>
      <details><summary>유사도 퍼센트가 높으면 더 재미있나요?</summary><p>유사도는 선택한 작품과 이야기·시각적 특징이 겹치는 정도예요. 재미있을 확률이나 작품의 품질 점수는 아닙니다. <a href="/methodology">추천 기준 자세히 보기</a></p></details>
      <details><summary>무료로 모든 회차를 볼 수 있나요?</summary><p>이 사이트는 작품을 찾아주는 추천 서비스예요. 실제 감상과 회차별 이용 조건은 각 작품의 공식 플랫폼에서 확인해주세요.</p></details>
    </div>
    <a className="public-text-link" href="/webtoons">작품별 소개와 비슷한 이야기 둘러보기 →</a>
  </section>
}

export function SiteFooter() {
  return <footer className="public-footer"><a href="/">웹툰추천</a><nav aria-label="사이트 안내"><a href="/webtoons">작품 둘러보기</a><a href="/methodology">추천 기준</a><a href="/about">서비스 소개</a></nav><p>작품의 권리는 각 권리자에게 있습니다. 감상은 공식 플랫폼에서 이어집니다.</p></footer>
}
