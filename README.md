> 2026-10-16 보안 보완: 최신 실행·환경 변수·배포 및 복구 절차는 프로젝트의 `docs/security-audit-2026-10-16/deployment.md`를 우선 참고하세요. 아래 과거 안내의 무인증 크롤링 트리거는 더 이상 제공하지 않습니다. 크롤러 설치는 npm ci를 사용합니다.

# 웹툰 추천 웹앱 — 프로젝트 가이드라인

네이버·카카오·카카오페이지 웹툰 메타데이터를 활용해 **추천·검색·필터** 기능을 제공하는 웹앱을 만드는 프로젝트입니다.  
데이터 원천은 오픈소스 [korea-webtoon-api](https://github.com/HyeokjaeLee/korea-webtoon-api)를 사용하고, **프론트엔드(Vercel)** 와 **백엔드 BFF(Railway)** 를 분리해 배포합니다.

---

## 목표와 범위

| 구분 | 내용 |
|------|------|
| **사용자 기능** | 웹툰 검색, 플랫폼/요일/무료·완결 필터, 상세 링크, (추후) 취향 기반 추천 |
| **데이터** | korea-webtoon-api가 수집·정규화한 웹툰 목록 — Windows **크롤러 콘솔**로 갱신 후 BFF JSON 카탈로그에 반영 ([아래](#크롤러-콘솔-windows-권장)) |
| **비범위(1차)** | 회원·리뷰·댓글, 실제 에피소드 읽기, 플랫폼 로그인 |

---

## 시스템 아키텍처 (권장)

```
┌─────────────────┐     HTTPS      ┌──────────────────────┐
│  React 웹앱      │ ──────────────▶│  추천 BFF API         │
│  (Vercel)        │   /api/*       │  (Railway)            │
└─────────────────┘                └──────────┬───────────┘
                                            │ HTTP (내부)
                                            ▼
                                 ┌──────────────────────┐
                                 │ korea-webtoon-api     │
                                 │ (Railway, 동일/별도)   │
                                 │ SQLite + 크롤러       │
                                 └──────────────────────┘
```

**왜 BFF를 두나요?**

- 브라우저가 Heroku/크롤러 API를 직접 두드리면 **CORS·레이트·동작 방식(health-check)** 에 묶입니다.
- 추천 점수, 캐시, 페이지 단위 응답 형태는 **우리 도메인 모델**로 맞추는 것이 유리합니다.
- Vercel 환경 변수에는 **우리 BFF URL만** 노출합니다.

---

## korea-webtoon-api 이해하기

### 제공 플랫폼

- `NAVER` — 네이버웹툰  
- `KAKAO` — 카카오웹툰  
- `KAKAO_PAGE` — 카카오페이지  

### 핵심 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/webtoons` | 필터·페이지네이션 목록 |
| `GET` | `/health-check` | 플랫폼별 **데이터 갱신 트리거** 및 상태 (`DataInfo[]`) |
| `PUT` | `/update/naver` | 네이버 크롤링 (6시간 이내면 스킵) |
| `PUT` | `/update/kakao` | 카카오 크롤링 |
| `PUT` | `/update/kakao-page` | 카카오페이지 크롤링 |
| `GET` | `/api-docs` | Swagger UI |

공개 인스턴스 예시: `https://korea-webtoon-api-cc7dda2f0d77.herokuapp.com`  
상세 스펙: [Swagger 문서](https://korea-webtoon-api-cc7dda2f0d77.herokuapp.com/api-docs)

### `GET /webtoons` 쿼리 파라미터

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `keyword` | string | — | 제목·작가 검색 (공백 무시, 대소문자 무시) |
| `provider` | `NAVER` \| `KAKAO` \| `KAKAO_PAGE` | — | 미지정 시 **전 플랫폼 통합 뷰** |
| `page` | number | `1` | 페이지 |
| `perPage` | number | `30` | 최대 **100** |
| `sort` | `ASC` \| `DESC` | `ASC` | 제목 정렬 |
| `isUpdated` | boolean | — | 최근 업데이트 작품만 |
| `isFree` | boolean | — | 무료 작품만 |
| `updateDay` | `MON`…`SUN` | — | 연재 요일 |

### 응답 형태 (`200`)

```json
{
  "webtoons": [
    {
      "id": "string",
      "title": "string",
      "provider": "NAVER",
      "updateDays": ["MON", "WED"],
      "url": "https://...",
      "thumbnail": ["https://..."],
      "isEnd": false,
      "isFree": true,
      "isUpdated": true,
      "ageGrade": 15,
      "freeWaitHour": 24,
      "authors": ["작가명"]
    }
  ],
  "total": 21635,
  "isLastPage": false
}
```

### 저장소 구조 (참고)

- 런타임 DB: **SQLite** (`database.sqlite`, 리포에 포함, TypeORM)
- 플랫폼별 테이블: `naver_webtoon`, `kakao_webtoon`, `kakao_page_webtoon`
- 통합 뷰: `normalized_webtoon` (서버 기동 시 `UNION ALL` 뷰 재생성)
- 갱신 메타: `data_info` (플랫폼별 `updateStartAt`, `updateEndAt`, `isHealthy`)

### ⚠️ 운영 시 반드시 알아야 할 동작

1. **`GET /webtoons`는 내부에서 `GET /health-check`를 먼저 호출**합니다.  
   `health-check`는 세 플랫폼 `PUT /update/*`를 연쇄 호출합니다.  
   → 목록 API 호출이 잦으면 **불필요한 갱신 시도·지연**이 생길 수 있습니다.

2. upstream `DOMAIN` 상수는 프로덕션에서 **Heroku URL로 고정**되어 있습니다.  
   자체 Railway에 API를 올릴 때는 **자기 자신을 가리키도록** `DOMAIN`을 환경 변수화하는 **포크/패치**가 필요합니다. (아래 「자체 호스팅」)

3. 데이터는 **6시간**마다만 실제 크롤링이 돌아갑니다 (`createUpdateMethod`). 그 안의 요청은 메타만 반환합니다.

---

## 데이터를 받아오는 전략 (상세 계획)

프로젝트는 **3단계**로 데이터 연동을 나누는 것을 권장합니다.

### Phase 0 — 로컬·프로토타입 (외부 공개 API)

**목적:** UI·필터 UX를 빠르게 검증.

1. BFF 또는 프론트(임시)에서 `WEBTOON_UPSTREAM_URL=https://korea-webtoon-api-cc7dda2f0d77.herokuapp.com` 설정.
2. `GET /webtoons`만 사용해 목록·검색 구현.  
3. 호출 빈도를 낮추기 위해 **TanStack Query `staleTime` 5~10분** 이상 권장.  
4. 프로덕션 전까지는 **공개 Heroku에 의존**하므로 SLA·트래픽 제한을 감안.

**제한:** 트래픽·지연·동작 변경에 취약. Phase 1 이후 전환.

---

### Phase 1 — 데이터 서비스 자체 호스팅 (Railway) ★ 권장 기본

**목적:** 우리 인프라에서 SQLite + 크롤러를 돌리고, BFF는 안정적으로 HTTP로만 소비.

#### 1) 리포지토리 연결 방식 (택 1)

| 방식 | 장점 | 단점 |
|------|------|------|
| **A. Git submodule** `services/korea-webtoon-api` | upstream 추적 용이 | 업데이트 머지 필요 |
| **B. Fork + Railway 연결** | 배포·패치 독립 | upstream 동기화 수동 |
| **C. npm/git 의존 없이 Railway에서 upstream repo 직접 배포** | 구조 단순 | 커스텀 패치 어려움 |

**권장:** **B(Fork)** + `DOMAIN` 환경 변수 패치 1커밋.

#### 2) 필수 패치 (자체 호스팅)

`src/constants/index.ts`의 `DOMAIN`을 예시처럼 변경:

```ts
export const DOMAIN =
  process.env.WEBTOON_API_PUBLIC_URL ??
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://korea-webtoon-api-cc7dda2f0d77.herokuapp.com');
```

Railway 서비스 URL을 `WEBTOON_API_PUBLIC_URL`에 설정합니다.  
→ `/webtoons`가 **자기 인스턴스**의 `health-check`만 호출하게 됩니다.

#### 3) Railway 배포 (데이터 API)

- **Build:** `yarn install && yarn build` (또는 `yarn start`가 ts-node면 build 없이 start만)
- **Start:** `yarn start` (`Procfile`: `web: yarn start`)
- **Port:** `PORT` (Railway 자동 주입)
- **영속성:** SQLite는 **반드시 Volume** 마운트  
  - 예: `/data/database.sqlite`  
  - TypeORM `database` 경로를 `process.env.SQLITE_PATH || 'database.sqlite'`로 변경 권장  
- **초기 데이터:** 첫 배포 시 리포의 `database.sqlite`를 Volume에 복사하거나, 배포 후 `PUT /update/*` 3회(또는 `GET /health-check` 1회)로 채움.

#### 4) 갱신 스케줄 (크롤러)

| 방법 | 설명 |
|------|------|
| **Railway Cron** | 6시간마다 `GET https://<data-api>/health-check` (또는 PUT 3개) |
| **BFF Cron** | BFF만 upstream health 호출, 사용자 요청과 분리 |

사용자-facing BFF는 **`/webtoons`를 고빈도로 호출하지 말고**, 아래 Phase 2 캐시를 사용합니다.

---

### Phase 2 — BFF 동기화·캐시 (추천 API의 기반)

**목적:** 빠른 추천·목록, upstream 특이 동작과 분리.

#### 옵션 2-A: **온디맨드 프록시 + 서버 캐시** (구현 빠름)

- BFF `GET /api/webtoons` → upstream `GET /webtoons` 프록시
- **Redis / in-memory**에 쿼리 키별 TTL 10~30분 캐시
- health-check 연쇄 호출을 피하려면 upstream에 **「목록만 조회」 경로를 포크로 추가**하는 것이 가장 깔끔함 (예: `GET /webtoons`에서 health-check 호출 제거)

#### 옵션 2-B: **전량 스냅샷 동기화** (추천·배치에 유리) ★ 추천 기능 확장 시

1. Railway Cron이 6~12시간마다 BFF 작업 실행  
2. `perPage=100`으로 `page`를 증가시키며 **전 페이지 순회** (`isLastPage === true`까지)  
3. PostgreSQL(Railway)에 `webtoons` 테이블 upsert (PK: `id` 또는 `provider + id`)  
4. 사용자 API는 **우리 DB만** 조회 → 추천 점수·태그·임베딩 저장 가능  

**동기화 pseudocode:**

```ts
let page = 1;
const perPage = 100;
for (;;) {
  const { webtoons, isLastPage } = await fetchUpstream({ page, perPage });
  await db.webtoons.upsertMany(webtoons);
  if (isLastPage) break;
  page += 1;
}
```

**장점:** 프론트 요청이 크롤러·SQLite와 무관, 추천 알고리즘을 SQL/배치로 자유롭게 설계.  
**단점:** 동기화 job·DB 스키마 관리 필요.

#### 옵션 2-C: **SQLite 파일만 주기적 pull** (비권장)

- GitHub의 `database.sqlite`(~6MB)를 주기적으로 다운로드  
- 버전 관리·동시성·라이선스/용량 이슈로 **HTTP API 동기화(2-B)보다 열등**

---

### Phase 3 — 추천 로직 (우리 백엔드 책임)

korea-webtoon-api는 **추천 엔진이 없습니다**. 다음은 BFF에서 구현합니다.

| 단계 | 입력 | 예시 출력 |
|------|------|-----------|
| 규칙 기반 v1 | `updateDay`, `isFree`, `provider`, `isUpdated` | 「오늘 연재 + 무료」 |
| 콘텐츠 기반 v2 | 사용자가 본 `id` 목록 (로컬/회원) | 같은 작가·유사 장르 |
| 협업 필터 v3 | 다수 사용자 행렬 | (회원·이벤트 수집 후) |

API 예시:

- `GET /api/recommendations?day=THU&limit=20`
- `POST /api/recommendations/personal` body: `{ seenIds: string[], preferences: {...} }`

데이터 소스는 Phase 2-B의 PostgreSQL이 가장 수월합니다.

---

## 권장 모노레포 구조

```
webtoon-recommend/
├── README.md                 # 이 문서
├── apps/
│   ├── web/                  # React (Vite) → Vercel
│   └── api/                  # BFF (Node + Fastify/Express) → Railway
├── services/
│   └── korea-webtoon-api/    # Fork 또는 submodule → Railway (선택)
├── packages/
│   └── shared-types/         # Webtoon DTO, Provider enum 공유
└── .github/workflows/        # lint, test, (선택) sync smoke
```

**GitHub 저장소:** 프론트·백엔드를 **한 repo**에 두고 Vercel/Railway 각각 Root Directory를 `apps/web`, `apps/api`로 지정하는 방식이 CI가 단순합니다.  
데이터 API는 **별도 Fork repo → Railway** 연결도 가능합니다.

---

## 프론트엔드 (React) 가이드

### 기술 스택 (권장)

- **React 19** + **TypeScript**
- **Vite** (빌드·HMR)
- **React Router** (또는 TanStack Router)
- **TanStack Query** — upstream/BFF 캐시·로딩·에러
- **Tailwind CSS** 또는 기존 UI 키트
- (선택) **Zustand** — 필터·온보딩 취향 상태

### 환경 변수 (Vercel)

| 변수 | 예시 |
|------|------|
| `VITE_API_BASE_URL` | `https://api.your-domain.com` |

브라우저는 **BFF만** 호출합니다. `korea-webtoon-api` URL은 노출하지 않습니다.

### 주요 화면 (1차)

1. **홈 / 추천** — 요일·무료 칩, 카드 그리드  
2. **검색** — `keyword` debounce  
3. **목록** — 플랫폼·필터·무한 스크롤 (`page`, `isLastPage`)  
4. **상세** — 썸네일, 작가, 외부 `url` 링크 (새 탭)

### 썸네일·CORS

이미지 URL은 네이버/카카오 CDN입니다.  
hotlink 차단 시 BFF **이미지 프록시** (`GET /api/thumbnail?url=`) 또는 `referrerPolicy` 조정을 검토합니다.

---

## 백엔드 BFF (Railway) 가이드

### 역할

- korea-webtoon-api **프록시 또는 DB 조회**
- 응답 DTO 정규화 (`thumbnail[0]` → `thumbnailUrl` 등)
- Rate limit, API key (필요 시), 추천 엔드포인트

### 환경 변수 (예시)

| 변수 | 설명 |
|------|------|
| `WEBTOON_UPSTREAM_URL` | 자체 호스팅 데이터 API base URL |
| `DATABASE_URL` | Phase 2-B PostgreSQL |
| `REDIS_URL` | (선택) 캐시 |
| `SYNC_CRON_SECRET` | Cron 엔드포인트 보호 |

### 배포

- **Root Directory:** `apps/api`
- Health: `GET /health` (Railway health check)
- Cron: Railway Scheduled Job → `POST /internal/sync-webtoons` + secret header

---

## 배포 체크리스트

### Vercel (Frontend)

- [ ] Framework Preset: Vite  
- [ ] Root: `apps/web`  
- [ ] `VITE_API_BASE_URL` 프로덕션 BFF URL  
- [ ] Preview 환경별 API URL 분리  

### Railway (BFF)

- [ ] Root: `apps/api`  
- [ ] `WEBTOON_UPSTREAM_URL`  
- [ ] (2-B 사용 시) PostgreSQL 플러그인 + migrate  
- [ ] Cron 동기화 job  

### Railway (korea-webtoon-api, Phase 1)

- [ ] Fork + `WEBTOON_API_PUBLIC_URL` 패치  
- [ ] Volume + `SQLITE_PATH`  
- [ ] 6h Cron → `health-check`  
- [ ] `/api-docs` 비공개 또는 IP 제한 (선택)  

---

## 개발 순서 (마일스톤)

1. **M1 — 스캐폴딩**  
   monorepo, `shared-types`, BFF `GET /api/webtoons` 프록시, React 목록·검색  
2. **M2 — 데이터 자체 호스팅**  
   Fork 배포, Volume, DOMAIN 패치, Cron 갱신  
3. **M3 — 캐시/동기화**  
   Redis 또는 PostgreSQL 전량 sync job  
4. **M4 — 추천 v1**  
   요일·무료·플랫폼 규칙 + 홈 섹션  
5. **M5 — UX·성능**  
   이미지 최적화, skeleton, a11y, E2E 테스트  

---

## 라이선스·출처

- [korea-webtoon-api](https://github.com/HyeokjaeLee/korea-webtoon-api) — MIT  
- 웹툰 메타데이터·이미지·링크는 **각 플랫폼 정책**을 따릅니다. 상업적 이용·크롤링 재배포 전 원저작자 리포 및 플랫폼 약관을 확인하세요.  
- 공개 API(Heroku)는 **개발 편의용**으로만 사용하고, 운영 트래픽은 자체 호스팅을 권장합니다.

---

## 참고 링크

- Upstream repository: https://github.com/HyeokjaeLee/korea-webtoon-api  
- API 문서 (Swagger): https://korea-webtoon-api-cc7dda2f0d77.herokuapp.com/api-docs  
- Vercel — Monorepo: https://vercel.com/docs/monorepos  
- Railway — Volumes & Cron: https://docs.railway.app  

---

## GitHub 저장소 (분리)

| | URL |
|--|-----|
| **Frontend** | https://github.com/GilHyeonSoo/webtoon-recommend-frontend |
| **Backend** | https://github.com/GilHyeonSoo/webtoon-recommend-api |
| **Crawler (fork)** | https://github.com/GilHyeonSoo/webtoon-korea-api |

Vercel Import 시 **Frontend** 저장소, Root Directory는 저장소 루트(`.`)입니다. Railway는 **Backend** 저장소를 연결합니다.

---

## 연결된 인프라 (현재)

검색·추천 서버는 배포에 포함된 `Backend/data/webtoons.json`을 읽으며 Supabase를 조회하지 않습니다. 유사도 계산은 Backend에서 수행합니다. Frontend의 JSON 원본을 갱신했다면 Backend에서 `npm run sync:catalog`를 실행해 복사하고 서버를 재시작하거나 재배포해주세요. Backend는 Frontend 폴더 없이 독립적으로 배포할 수 있습니다. 아래 Supabase 적재와 Railway 설정은 기존 인프라에 관한 것이며, 이번 변경으로 배포 서비스가 갱신되지는 않습니다.

| 서비스 | 리소스 |
|--------|--------|
| **Supabase** | 프로젝트 `xcramulipbsvujoaviol` · 테이블 `public.webtoons` (30건 시드됨) |
| **Railway** | 워크스페이스 **Gil's Projects** · 프로젝트 `precious-encouragement` · 서비스 `webtoon-api` |
| **API URL** | https://webtoon-api-production-5e28.up.railway.app |

```bash
# DB 마이그레이션
supabase db push --linked

# JSON → Supabase
cd Backend && cp ../.env.example .env   # 키 입력 후
npm run seed

# 로컬 API
cd Backend && npm run dev

# 프론트 (Railway API 사용)
cd Frontend && cp .env.example .env.local && npm run dev
```

### Vercel (Frontend)

1. GitHub에 저장소 push 후 [Vercel Import](https://vercel.com/new) → **Root Directory: `Frontend`**
2. 환경 변수 `VITE_API_URL` = Railway API URL (제목 검색과 즐겨보는 웹툰 종합 추천에 사용)
3. 상세: [docs/VERCEL-DEPLOY.md](docs/VERCEL-DEPLOY.md) · CLI: `./scripts/deploy-vercel.sh`

Railway 배포: `Backend` 디렉터리에서 `railway up` (Google Drive 경로 이슈 시 `/tmp`에 복사 후 배포).

---

## 로컬 데이터 API (`KOREA_WEBTOON_API`)

Fork·확장 내용은 [`KOREA_WEBTOON_API/EXTENSIONS.md`](KOREA_WEBTOON_API/EXTENSIONS.md) 참고.

| 작업 | 명령 |
|------|------|
| 샘플 JSON (루트 `webtoons-sample.json`) | `./scripts/export-webtoons-sample.sh` |
| 플랫폼별 10작품 JSON | `./scripts/export-webtoons-by-platform.sh` → `data/webtoons/` |
| 네이버 synopsis·태그 DB 보강 | `./scripts/enrich-naver-metadata.sh` (`ENRICH_LIMIT=100`) |
| API 서버 | `cd KOREA_WEBTOON_API && npm run dev` → `/api-docs` |
| **Windows 크롤·통합·배포 UI** | [`tools/crawler-console/README.md`](tools/crawler-console/README.md) — 로컬 콘솔 (권장) |

추가 엔드포인트: `GET /webtoons/:id`, `PUT /enrich/naver`.  
운영 크롤러는 `ENABLE_ADMIN_HTTP` + `CRAWLER_ADMIN_SECRET`으로 관리 API를 보호합니다 (`docs/security-audit-2026-10-16/deployment.md`).

### 공통 작품 필드 (네이버·카카오)

| 필드 | 네이버 | 카카오 | 없을 때 |
|------|--------|--------|---------|
| `averageRating` | 목록 `starScore` | — | `null` |
| `primaryGenre` | 상세 `GENRE_*` | `seoKeywords[0]` | `"unknown"` |
| `totalEpisodeCount` | 회차 API `totalCount` | — | `null` |
| `isOnHiatus` | 목록/상세 `rest` | — | `null` |
| `popularityCount` | 상세 `favoriteCount` | — | `null` |

검증: `yarn test:common-fields` (실 API smoke test).

---

## 크롤러 콘솔 (Windows, 권장)

Windows PC에서 **네이버·카카오 크롤 → JSON 통합 → Git push · Railway/Vercel 배포**까지 버튼으로 실행하는 로컬 UI입니다.  
상세 설정·문제 해결: **[`tools/crawler-console/README.md`](tools/crawler-console/README.md)**

### 데이터 파이프라인

```
[1 크롤]  KOREA_WEBTOON_API  →  SQLite (로컬)
[2 통합]  export → merge → Backend sync:catalog
          → Frontend/src/data/webtoons.json
          → Backend/data/webtoons.json   ← BFF 런타임 카탈로그
[3 배포]  git push (+ 선택 railway up / vercel --prod)
```

프로덕션 **추천 BFF**는 Supabase가 아니라 **`Backend/data/webtoons.json`** 을 기동 시 읽습니다. 카탈로그를 바꾼 뒤에는 Backend 재배포(또는 Git 연동 자동 빌드)가 필요합니다.

### 사전 준비

| 항목 | 용도 |
|------|------|
| **Node.js 22+** | 크롤러·콘솔·Backend `sync:catalog` |
| **Git** + `origin` remote | 3단계 push |
| **`Backend` · `KOREA_WEBTOON_API`** 각각 `npm ci` | 통합·크롤 |
| **Railway CLI** (3단계, 선택) | `Backend`에서 `railway login` · `railway link` |
| **`config.json`** | `tools/crawler-console/config.example.json` 복사 후 `adminSecret` (32자+) |

Google Drive **한글 경로**에서는 `sqlite3` 빌드·Railway 업로드가 깨질 수 있습니다.  
`start-crawler.ps1`은 기본적으로 **`%LOCALAPPDATA%\webtoon-crawler\`** 에 API 복사본을 두고, 배포 시 **`useTempCopyOnWindows`** 로 Backend 임시 복사를 지원합니다.

### 실행

PowerShell **두 개**:

```powershell
cd tools\crawler-console
.\start-crawler.ps1    # 터미널 A — 크롤러 API (127.0.0.1:3000)
.\start-console.ps1    # 터미널 B — UI http://127.0.0.1:3780/
```

| UI 단계 | 동작 |
|---------|------|
| **1. 네이버 / 카카오** | `PUT /update/*` → SQLite 저장 |
| **2. 통합 실행** | `export:platform` → `merge-frontend-webtoons.mjs` → `npm run sync:catalog` |
| **3. 배포 실행** | 카탈로그 파일만 commit · push · (설정 시) `railway up` / Vercel |

`config.json`의 **`deploy`** 블록으로 Git 브랜치, Railway/Vercel on·off를 조정합니다. GitHub에 Backend만 연결되어 **push만으로 Railway가 빌드**되면 `deploy.railway.enabled: false`로 CLI 배포를 끌 수 있습니다.

스케줄 실행: Windows **작업 스케줄러**에서 `start-console.ps1` API를 호출하는 대신, [`scripts/trigger-crawler.mjs`](scripts/trigger-crawler.mjs)(서버 측 크롤) + 통합·배포는 콘솔 버튼 또는 아래 수동 스크립트를 조합해 사용합니다.

---

## Windows 수동 절차 (고급)

콘솔 없이 PowerShell·npm만으로 같은 작업을 할 때 참고합니다.

### 의존성

```powershell
cd KOREA_WEBTOON_API
npm ci
cd ..\Backend
npm ci
```

`sqlite3` 빌드 오류 시 프로젝트를 **짧은 영문 경로**(예: `C:\dev\webtoon-recommend`)로 옮기거나 Visual Studio Build Tools(C++) 설치 후 재시도.

### 크롤 · export · merge

관리 API로 갱신 (`ENABLE_ADMIN_HTTP=true`, `CRAWLER_ADMIN_SECRET` 필요). 공개 `health-check`로 크롤을 **시작하지 않습니다**.

```powershell
cd KOREA_WEBTOON_API
npm start
# 다른 터미널: scripts/trigger-crawler.mjs (CRAWLER_BASE_URL, CRAWLER_ADMIN_SECRET 설정)

$env:COUNT_PER_PLATFORM="50000"
$env:EXPORT_OUTPUT_DIR="C:\dev\webtoon-recommend\data\webtoons"
npm run export:platform

cd C:\dev\webtoon-recommend
node scripts\merge-frontend-webtoons.mjs
cd Backend
npm run sync:catalog
```

Google Drive에서 export만 할 때: [`scripts/export-webtoons-by-platform.sh`](scripts/export-webtoons-by-platform.sh)와 동일하게 `%TEMP%\KOREA_WEBTOON_API_RUN`에 복사 후 실행.

### Supabase 적재 (선택, BFF JSON과 별도)

```powershell
cd Backend
# .env에 SUPABASE_* 설정
npm run seed
```

리포에 포함된 [`scripts/sync-webtoons.ps1`](scripts/sync-webtoons.ps1)은 export + seed + merge까지 한 번에 돌립니다(배포·`sync:catalog`는 콘솔 2~3단계 권장).

### 공통 필드 smoke test

```powershell
cd KOREA_WEBTOON_API
npm run test:common-fields
```

---


## 다음 작업 (이 README 이후)

1. `apps/web`, `apps/api` 스캐폴딩 생성  
2. BFF가 `KOREA_WEBTOON_API`를 프록시·캐시  
3. 즐겨보는 웹툰 1~3개 기반 종합 유사도 추천 v1  

질문이나 우선순위(추천 알고리즘 vs 검색 UX)가 정해지면 마일스톤 순서를 조정하면 됩니다.
