# 웹툰 추천 프로젝트 안내

작성 기준: 2026-10-26 로컬 소스. 운영 서비스의 배포 상태를 확인한 문서는 아니다. 작업 폴더에 기존 미커밋 변경이 있으므로 커밋본과 차이가 있을 수 있다.

build의 독립 분석·테스트 기준은 clean worktree의 `crew/crew-build` 브랜치, 커밋 `d67dd5a`다. 아래 설명은 lead의 현재 소스 확인을 함께 반영하며, UI·크롤러 export·콘솔의 미커밋 변경까지 테스트되었다는 의미는 아니다.

## 어떤 서비스인가

사용자가 즐겨보는 웹툰을 1~3개 고르면, 작품 메타데이터가 비슷한 다른 웹툰을 추천하는 웹앱이다. 네이버웹툰·카카오웹툰·카카오페이지를 대상으로 하며, 제목 검색과 플랫폼·연재 상태 필터를 제공한다. 작품 감상은 각 플랫폼의 원문 링크로 이동한다.

현재 추천은 외부 생성형 AI 호출이나 회원 행동 기반 학습이 아니라, 카탈로그의 특징을 비교하는 콘텐츠 기반 추천이다.

## 구성과 역할

| 구성 | 기술 및 역할 | 먼저 읽을 파일 |
|---|---|---|
| Frontend | React 19, TypeScript, Vite. 작품 선택·검색·추천 결과 UI | `Frontend/src/App.tsx`, `Frontend/src/api/webtoons.ts` |
| Backend | Express, TypeScript. 검색·상세·추천 API와 추천 worker | `Backend/src/index.ts`, `Backend/src/app.ts` |
| KOREA_WEBTOON_API | TypeORM·SQLite 기반 수집 및 메타데이터 보강 | `KOREA_WEBTOON_API/src/index.ts` |
| 크롤러 콘솔 | Windows 로컬 수집·통합·배포 작업 UI | `tools/crawler-console/README.md` |

검색·추천 서버의 실제 데이터 원본은 **`Backend/data/webtoons.json`**이다. 서버 시작 때 검증해 메모리에 올리고 추천 인덱스를 준비한 뒤 요청을 받는다. 이 실행 경로에는 Supabase 키나 Frontend 폴더가 필요하지 않다. Supabase seed는 별도로 실행하는 적재 도구다.

## 사용자가 추천을 받는 흐름

1. Frontend에서 제목을 입력하면 `GET /api/webtoons`로 검색한다.
2. 서로 다른 작품을 1~3개 고르고 `POST /api/recommendations`로 분석을 요청한다.
3. Backend는 전체 카탈로그에서 선택 작품과 제외 작품을 빼고, 플랫폼·연재 상태 조건에 맞는 후보를 고른다.
4. 추천 worker가 유사도로 정렬하고, Frontend는 기본 최대 10개의 작품과 추천 이유를 표시한다.
5. 같은 조건에서 재검색하면 Frontend가 이미 본 추천 ID를 누적 전달한다. 필터를 바꾸거나 새 분석을 시작하면 이력을 초기화한다. 이력은 서버에 영구 저장하지 않는다.

카카오 필터는 카카오웹툰과 카카오페이지를 함께 포함한다. 현재 구현에서 휴재작은 ‘완결(휴재)’에 포함되며 ‘연재 중’에서는 제외된다.

## 추천 점수가 뜻하는 것

`Backend/src/lib/similarity.ts`는 장르·태그·줄거리·제목·작가를 각각 벡터로 만들고 TF-IDF와 코사인 유사도를 사용한다. 기본 채널 가중치는 장르 38%, 태그 30%, 줄거리 17%, 제목 10%, 작가 5%다. 비교할 정보가 없는 채널은 제외하고 남은 가중치를 다시 정규화하므로, 모든 작품에 고정 비율이 그대로 적용되는 것은 아니다.

여러 선택 작품은 같은 비중으로 취향 프로필에 반영한다. 플랫폼·상태 필터는 후보를 줄일 뿐 점수를 올리지 않는다. 표시되는 백분율은 특징 유사도이며, 사용자가 좋아할 확률이나 만족도 예측값이 아니다. 메타데이터가 부족하면 점수가 0일 수 있다.

## 데이터 갱신 경로

```text
플랫폼 수집·보강 → 로컬 SQLite
  → 플랫폼별 JSON export → merge
  → Frontend/src/data/webtoons.json
  → Backend의 npm run sync:catalog
  → Backend/data/webtoons.json
  → Backend 재시작 또는 재배포
```

사용자의 검색·추천 요청은 크롤링을 시작하지 않는다. Frontend JSON만 바꿔서는 실행 중인 Backend 카탈로그가 갱신되지 않는다. `sync:catalog`는 모노레포의 Frontend 원본을 사용하는 관리 명령이며, 서버 실행 자체는 Backend만으로 가능하다.

Windows 수집 작업의 구체적인 설정은 `tools/crawler-console/README.md`를 확인한다. 현재 작업본에는 export 보강 실패 재시도 등의 변경이 있으므로 실제 작업본을 기준으로 확인해야 한다.

## 로컬 실행

프로젝트 전체를 다룰 때는 Node.js 22.12 이상과 npm을 기준으로 한다. 아래 두 터미널에서 각각 실행한다.

```sh
# 터미널 1: 프로젝트 루트에서
cd Backend
npm ci
npm run dev
```

```sh
# 터미널 2: 프로젝트 루트에서
cd Frontend
npm ci
npm run dev
```

Backend 기본 포트는 3001이다. Frontend 개발 서버의 `/api`는 `http://127.0.0.1:3001`로 프록시된다. 이 기본 경로에서는 Supabase나 크롤러를 실행하지 않아도 검색·추천을 사용할 수 있다.

검증 명령은 Backend와 Frontend에서 각각 `npm test`, `npm run build`다. 크롤러는 `npm test`, `npm run typecheck`를 제공한다. `test:common-fields`는 외부 플랫폼 API를 사용하는 별도 smoke test다.

### 이번 분석에서 확인한 테스트 결과

build가 Node.js v24.10.0, 커밋 `d67dd5a`의 별도 worktree에서 의존성 설치 없이 실행한 결과다.

| 대상 | 결과 | 해석 |
|---|---|---|
| Frontend `npm test` | 11 pass / 0 fail | 해당 커밋의 테스트 통과. 현재 미커밋 UI 변경·빌드·브라우저 동작 검증을 포함하지 않는다. |
| Backend `npm test` | 0 pass / 3 fail, `ERR_MODULE_NOT_FOUND: tsx` | 테스트 파일 3개가 필수 실행 의존성 부재로 실패했다. 기능 결함 여부는 이 결과로 판단할 수 없다. |

Backend는 의존성을 설치한 환경에서 다시 검증해야 한다. 이번 분석에서는 패키지 설치, 빌드, 실제 수집 및 운영 배포 검증을 수행하지 않았다.

### 독립 교차 검토 결과

review-sec(Antigravity)는 `UNIT: build`, `VERDICT: APPROVE`로 회신했다. `d67dd5a` 기준 아키텍처·인증·데이터 흐름과 안내문의 런타임 데이터 원본, 추천 파이프라인, `tsx` 부재에 따른 테스트 실패 해석이 소스와 일치한다고 확인했다. lead 작업본의 Frontend 스타일, `enrichExportBatch` 재시도 및 콘솔 UTF-8 변경도 검토 범위에 포함했다. 이 검토는 미커밋 변경의 실행 테스트 통과를 의미하지 않는다.

검토 근거는 `Backend/src/index.ts`, `Backend/src/app.ts`, `Backend/src/lib/localCatalog.ts`, `Backend/src/lib/similarity.ts`, `Backend/src/lib/recommendationPool.ts`, `Frontend/src/api/webtoons.ts`, `Frontend/vercel.json`, `KOREA_WEBTOON_API/src/app.ts`, `KOREA_WEBTOON_API/src/routes/health-check.ts`, `KOREA_WEBTOON_API/src/security/admin.ts` 및 이 안내문이다.

의존성 설치 후 Backend 전체 테스트 통과 여부, 외부 플랫폼 실시간 크롤링, Railway/Vercel의 실제 운영 배포 동작은 미검증이다. 이번 승인은 프로젝트 분석과 안내문의 정확성에 대한 승인이다.

## 배포·운영에서 알아둘 점

- Frontend는 Vercel, Backend는 Railway를 사용하는 배포 설정이 있다. 실제 서비스가 이 로컬 코드와 같은 버전인지는 별도 확인이 필요하다.
- Frontend는 같은 origin의 `/api` 프록시를 사용하거나 `VITE_API_URL`로 Backend를 지정한다. 실제 배포 주소와 프록시 목적지가 맞아야 한다.
- Backend 프로덕션 실행에는 정확한 HTTPS origin의 `CORS_ORIGIN` 설정이 필요하다. `/health`는 생존 상태, `/ready`는 추천 worker 준비 상태다.
- Backend에는 요청 빈도 제한, 추천 worker 1개, 대기열 상한, 요청 기한이 구현돼 있다. 여러 인스턴스의 서비스 전체 제한과 프록시 신뢰 설정은 운영 환경에서 확인해야 한다.
- 크롤러의 관리 HTTP는 기본 비활성화다. 활성화할 때 `ENABLE_ADMIN_HTTP=true`와 32자 이상의 `CRAWLER_ADMIN_SECRET`이 필요하며, 관리 요청은 `x-crawler-secret` 헤더를 사용한다. 크롤러는 사설 또는 로컬 접근을 기준으로 운영한다.
- 현재 `GET /health-check`는 저장된 상태 조회다. 과거 README에 있는 ‘health-check를 호출하면 수집 시작’ 설명은 현재 동작과 다르다.

최신 실행·운영 절차는 [보안 보완 배포 안내](security-audit-2026-10-16/deployment.md)를 우선 참고한다. 같은 폴더의 초기 보안 보고서는 수정 이전 문제를 포함하므로, 현재 미해결 문제 목록으로 그대로 해석하면 안 된다.

## 코드를 읽는 순서

1. `Frontend/src/App.tsx`: 화면 상태와 검색·추천 요청의 연결.
2. `Frontend/src/api/webtoons.ts`: API 계약과 응답 검증.
3. `Backend/src/app.ts`: 요청 검증, 검색·추천 라우트, 오류 처리.
4. `Backend/src/lib/localCatalog.ts`: 실제 런타임 데이터 원본과 검색 방식.
5. `Backend/src/lib/similarity.ts`: 추천 특징·가중치·정렬.
6. `Backend/src/lib/recommendationPool.ts`: worker, 대기열, 취소·기한 처리.
7. 크롤러 콘솔 README와 보안 보완 배포 안내: 데이터 갱신 및 운영.

루트 README에는 초기 설계와 현재 구현 설명이 섞여 있다. `apps/web`, `apps/api`, 실시간 upstream 프록시, PostgreSQL 동기화 등은 현재 구조를 설명하는 것으로 간주하지 말고 해당 실행 코드를 확인한다.
