> 2026-10-16 보안 보완: 최신 실행·환경 변수·배포 및 복구 절차는 프로젝트의 `docs/security-audit-2026-10-16/deployment.md`를 우선 참고하세요. 아래 과거 안내의 무인증 크롤링 트리거는 더 이상 제공하지 않습니다. 크롤러 설치는 npm ci를 사용합니다.

# webtoon-recommend-api

Express 검색·종합 추천 BFF입니다. 검색·작품 상세·추천 후보는 백엔드에 포함된 `data/webtoons.json`에서 가져오고, 유사도 계산은 백엔드에서 수행합니다. 서버 실행에는 Frontend 폴더나 Supabase 설정이 필요하지 않으며 Supabase에 접속하지 않습니다.

## API

- `GET /health`
- `GET /api/webtoons?q=제목일부&provider=NAVER|KAKAO|KAKAO_PAGE&limit=12`
  - `q`, `provider` 생략 가능. limit 기본 50, 1~100.
  - 제목 부분 일치, 대소문자 구분 없음. `%`, `_`도 문자 그대로 검색.
  - 응답 `{ webtoons, count, total }`.
- `GET /api/webtoons/:id`
- `POST /api/recommendations`
  - JSON `{ "webtoonIds": ["naver_641253", "kakao_3090"], "limit": 10 }`
  - 서로 다른 작품 1~3개. limit 기본 10, 1~20.
  - 선택적 `preferences`: `{ "platform": "any|naver|kakao", "completion": "any|ongoing|complete" }`.
  - 카카오는 KAKAO와 KAKAO_PAGE를 함께 포함. complete는 완결 또는 휴재, ongoing은 완결·휴재를 모두 제외.
  - 전체 후보에 필터를 적용한 다음 상위 limit개를 반환. 필터 선택 여부로 유사도를 증폭하지 않음.
  - 같은 필터에서 재검색 시 선택적 `excludeIds: string[]`에 이미 표시된 추천 ID를 누적 전달. 필터 변경·초기화 시 프론트가 이력을 비우고 제외 목록 없이 요청. 최대 50,000개, 중복·빈 ID 불가. 선택 작품과 제외 작품을 후보에서 제외한 뒤 상위 limit개를 반환하며 전체 카탈로그에 기반한 유사도 점수는 유지. 후보 소진 시 빈 배열 반환. 서버에 이력을 저장하지 않으며 프론트가 같은 필터 조건에서 재검색하는 동안 유지.
  - 응답 `{ selected, recommendations: [{ webtoon, similarity, reasons }], catalogCount, method }`.
  - 잘못된 입력 400, 없는 작품 404, 처리 오류 500.

로컬 JSON은 읽기 전용입니다. `/internal/seed-webtoons` 경로는 제공하지 않습니다.

## 유사도 v1

장르(가중치 3), 태그(2), 한국어를 포함한 줄거리 문자 바이그램(0.6, 반복 상한 1.2)을 TF-IDF 벡터로 만듭니다. 플랫폼 장르명은 공통 한글명으로 정규화하고 태그에 명시된 장르명도 사용합니다. 각 선택 작품 벡터를 정규화한 뒤 같은 비중으로 합쳐 코사인 유사도로 정렬합니다.

선택 작품은 후보에서 제외합니다. 정보가 없는 작품의 유사도는 0이며, 임의의 취향이나 일치율을 만들어내지 않습니다. 0점 후보는 결과 뒤쪽에 정보 부족 이유와 함께 표시합니다. 동점은 제목·ID 순서로 정렬합니다. 점수는 선호 확률이 아닙니다.

JSON 전체를 서버 시작 시 메모리에 불러옵니다. 추천은 전체 목록을 후보로 사용하며 검색 결과 12건으로 제한하지 않습니다. 파일을 수정한 뒤에는 백엔드를 재시작해주세요. 파일이 없거나 잘못되면 서버 시작에 실패하며 다른 데이터 소스로 전환하지 않습니다.

`data/webtoons.json`은 배포에 포함해야 하는 파일입니다. 현재 Frontend의 JSON 목록을 복사해 두었습니다. 원본을 갱신한 경우 모노레포의 Backend 디렉터리에서 `npm run sync:catalog`를 실행해 다시 복사하고, 변경된 JSON을 Backend 저장소에도 반영해주세요. 이 동기화 명령만 Frontend 폴더를 필요로 하며 빌드·실행·Docker 배포는 독립적으로 동작합니다. Backend의 JSON을 직접 갱신해도 됩니다.

추천 개수는 JSON에 있는 전체 작품 중 선택한 작품을 제외한 후보 수에 따라 달라집니다.

## 로컬

```bash
npm install
npm run dev
```

기본 포트는 3001입니다. 필요하면 `.env`에 `PORT`, `CORS_ORIGIN`만 설정합니다. 기존 Supabase 환경 변수가 있어도 검색·추천 서버에서는 사용하지 않습니다.

기존 `npm run seed`는 별도의 Supabase 적재 도구입니다. 명시적으로 실행할 때만 Supabase 설정과 쓰기 권한이 필요하며 로컬 서버 실행과는 무관합니다.

DB 설정 없이 저장된 스냅샷으로 UI를 검증하는 명시적 QA 서버:

```bash
node --import tsx tests/preview.ts
```

QA 서버는 127.0.0.1:3001, 실제 라우트·추천 함수, 저장된 6개 작품을 사용하며 DB 쓰기는 하지 않습니다. 운영 서버가 자동으로 이 모드로 전환되지 않습니다.

```bash
npm test
npm run build
```

## 배포

`npm run build` 후 `npm start`로 실행합니다. 서버의 `dist/`와 같은 상위 폴더에 `data/webtoons.json`이 있어야 합니다. Dockerfile은 해당 JSON을 `/app/data/webtoons.json`으로 포함하고 빌드된 서버는 이 내부 경로에서 읽습니다.

Backend 디렉터리만으로 Docker 이미지를 만들 수 있습니다.

```bash
docker build -t webtoon-api .
docker run --rm -p 3001:3001 webtoon-api
```

Railway는 기존처럼 Backend 디렉터리를 배포하면 됩니다. Supabase 키는 필요하지 않습니다. 웹툰 목록을 갱신하려면 Backend의 JSON 변경을 포함해 다시 배포해주세요. 프론트는 배포된 API 주소를 `VITE_API_URL`로 지정합니다. 로컬 변경만으로 기존 Railway API가 갱신되지는 않습니다.
