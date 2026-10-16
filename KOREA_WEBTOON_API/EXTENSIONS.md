# Fork 확장 사항

## 추가 필드

| 필드 | 설명 |
|------|------|
| `synopsis` | 줄거리 또는 한 줄 소개 |
| `genres` | 장르 (플랫폼별 정규화) |
| `tags` | 큐레이션·SEO 태그 |
| `averageRating` | 평균 평점 (네이버 `starScore`, 카카오 없으면 `null`) |
| `primaryGenre` | 대표 장르 (`unknown` 기본) |
| `totalEpisodeCount` | 총 회차 (네이버 `totalCount`, 카카오 `null`) |
| `isOnHiatus` | 휴재 (네이버 `rest`, 카카오 `null`) |
| `popularityCount` | 인기 지표 (네이버 `favoriteCount`, 카카오 `null`) |

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/webtoons` | 목록 (스키마에 확장 필드 포함) |
| `GET` | `/webtoons/:id?enrich=true&persist=false` | 단건 조회·온디맨드 보강 |
| `PUT` | `/enrich/naver?limit=50&delayMs=200` | 네이버 synopsis·태그 배치 수집 |

## 스크립트

```bash
yarn export:sample          # 루트 webtoons-sample.json (플랫폼별 2작품)
yarn export:platform        # data/webtoons/webtoons-{naver,kakao,kakao-page}.json (기본 10작품)
                           # EXPORT_PROVIDERS=NAVER,KAKAO 또는 EXPORT_SKIP_KAKAO_PAGE=1 로 카카오페이지 제외
yarn enrich:naver           # ENRICH_LIMIT=30 네이버 DB 보강
```

Google Drive 한글 경로에서 `sqlite3` 빌드 실패 시 프로젝트 루트의 `./scripts/export-webtoons-sample.sh` 사용.

### 카카오페이지 GraphQL 403

일부 IP(로컬·CI)에서는 `page.kakao.com/graphql`이 403을 반환할 수 있습니다. Referer·Origin·UA·재시도를 적용해 두었으며, 상세 수집은 **기본 동시 5건** (`KAKAO_PAGE_CONCURRENCY`로 조정, 예: `3`)으로 제한합니다. **전체 `PUT /update/kakao-page` 크롤**은 Railway 등 서버 환경에서 재검증이 필요합니다. 로컬 샘플 export 시 카카오페이지 `synopsis`가 비어 있을 수 있습니다.
