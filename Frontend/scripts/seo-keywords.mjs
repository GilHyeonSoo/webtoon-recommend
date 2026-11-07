// Build-time metadata only. These terms are never rendered as a keyword list in the page body.
export const keywordGroups = {
  service: [
    '웹툰', '웹툰 추천', '웹툰 추천 사이트', '웹툰 추천 서비스', '맞춤 웹툰 추천',
    '취향별 웹툰 추천', '개인화 웹툰 추천', '나에게 맞는 웹툰', '내 취향 웹툰', '웹툰 추천 도구',
    '웹툰 추천 받기', '웹툰 추천받는 방법', '웹툰 추천 기준',
    '웹툰 추천 이유', '웹툰 선택 도우미', '웹툰 취향 분석', '웹툰 취향 찾기', '웹툰 취향 비교',
    '웹툰 취향 탐색', '웹툰 추천 결과', '웹툰 추천 목록', '웹툰 작품 소개', '웹툰 비교 가이드',
  ],
  discovery: [
    '비슷한 웹툰', '닮은 웹툰', '유사한 웹툰', '유사 웹툰 추천', '웹툰 유사도',
    '웹툰 유사도 비교', '웹툰 특징 비교', '웹툰 찾아보기', '새로운 웹툰 찾기', '다음에 읽을 웹툰',
    '좋아하는 웹툰으로 추천', '재미있게 본 웹툰으로 추천', '읽었던 웹툰과 비슷한 작품', '웹툰 한 작품으로 추천', '웹툰 여러 작품으로 추천',
    '웹툰 세 작품 비교', '웹툰 선택 추천', '웹툰 맞춤 검색', '웹툰 제목 검색', '웹툰 작가 정보',
    '관련 웹툰 찾기', '웹툰 추천 재검색', '새 웹툰 발견', '웹툰 읽을거리', '웹툰 비교 추천',
  ],
  story: [
    '장르별 웹툰 추천', '장르 기반 웹툰 추천', '같은 장르 웹툰', '장르가 비슷한 웹툰', '웹툰 장르 비교',
    '태그 기반 웹툰 추천', '태그가 비슷한 웹툰', '웹툰 태그 비교', '웹툰 취향 태그', '웹툰 설정 비교',
    '줄거리 기반 웹툰 추천', '줄거리가 비슷한 웹툰', '웹툰 줄거리 비교', '이야기가 비슷한 웹툰', '설정이 비슷한 웹툰',
    '웹툰 분위기 비교', '웹툰 제목으로 추천', '웹툰 작가로 추천', '작품 정보 기반 추천',
    '웹툰 비교할 점', '웹툰 취향 가이드',
  ],
  platforms: [
    '네이버 웹툰 추천', '네이버웹툰 추천', '카카오 웹툰 추천', '카카오웹툰 추천', '네이버 카카오 웹툰 비교',
    '플랫폼별 웹툰 추천', '다른 플랫폼 웹툰 찾기', '웹툰 플랫폼 비교', '네이버 웹툰 찾기', '카카오 웹툰 찾기',
    '네이버 비슷한 웹툰', '카카오 비슷한 웹툰', '웹툰 공식 플랫폼',
  ],
  spellings: [
    '웹툰추천', '웹툰추천사이트', '비슷한웹툰',
    '웹툰 추전', '웹툰 추쳔', '웹툰 추찬', '웹툰 츄천', '웹툰 춫천',
    '웹튼 추천', '웝툰 추천', '웹툰 추천 싸이트', '웹툰 추천 싸이틑', '웹툰 추천사이틑',
    '네이버 웹튼 추천', '카카오 웹튼 추천',
  ],
  english: [
    'webtoon recommendations', 'webtoon recommendation site', 'webtoon recommender', 'similar webtoons',
    'personalized webtoon recommendations', 'Korean webtoon recommendations', 'Naver webtoon recommendations', 'Kakao webtoon recommendations',
  ],
  reading: [
    '웹툰 읽기 가이드', '좋아할 웹툰 찾기', '추천 웹툰 살펴보기', '웹툰 선택 가이드', '취향에 맞는 이야기',
    '웹툰 내용 비교', '비슷한 이야기 찾기', '새로운 이야기 발견', '웹툰 작품 찾기', '웹툰 추천 사이트 찾기',
    '웹툰 소개 읽기', '웹툰 추천 이용 안내', '좋아하는 이야기 찾기', '웹툰 취향별 찾기', '다음 읽을거리 추천',
  ],
}

export const baseKeywords = [...new Set(Object.values(keywordGroups).flat())]

const privateSeoTerms = /그림체|그림채|작화|썸네일|상반신|시각적\s*특징|표지\s*(?:분석|비교)|이미지\s*(?:분석|유사도)|art[\s-]*style|visual[\s-]*(?:similarity|features)|cover[\s-]*(?:comparison|analysis)|DINOv2|WD[\s-]?14|HDBSCAN|UMAP|cosine|similarThreshold|artMatches|artCalibration|similar-art-style|(?:75|25)\s*%/i

export const containsPrivateSeoTerms = (value) => privateSeoTerms.test(String(value))

export function createKeywords(context = []) {
  const terms = [...context, ...baseKeywords]
    .map((term) => String(term).normalize('NFKC').replace(/[,;<>]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((term) => term.length > 0 && term.length <= 120 && !containsPrivateSeoTerms(term))
  return [...new Set(terms)]
}
