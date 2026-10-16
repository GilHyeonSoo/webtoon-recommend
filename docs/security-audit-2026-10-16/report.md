# 웹툰 추천 프로젝트 보안 점검

점검일: 2026-10-16 (Asia/Seoul)

가장 먼저 고칠 부분은 **추천 요청의 CPU 소모**와 **크롤러 관리 기능의 인증 부재**다. 전자는 현재 Backend 실행 코드에 해당한다. 후자는 KOREA_WEBTOON_API가 외부에 노출되어 있을 때 원격 공격 경로가 된다.

코드와 로컬 재현에서 7개 문제를 확인했다. 별도로 2개 조건부 위험, 의존성 보안 공지와 운영 보완 사항을 기록했다. 서로 연결되는 문제를 각각 설명하되, 이를 독립적인 침해 사고나 CVE 개수로 해석하면 안 된다.

## 범위와 검증 수준

- Frontend, Backend, KOREA_WEBTOON_API의 서버 진입점·라우트·데이터 처리·외부 요청, Supabase 마이그레이션, 배포 설정, 잠금 파일을 검토했다.
- Backend의 현재 진입점은 로컬 JSON 저장소를 사용한다. Supabase나 크롤러를 사용자 요청에서 호출하지 않는다. 크롤러 문제를 곧바로 현재 추천 사이트의 DB 탈취로 해석할 수 없다.
- 실제 카탈로그 6,010개로 추천 함수를 제한된 횟수 실행했다. Express의 등록된 CORS 미들웨어와 라우트 핸들러도 직접 호출했다.
- 크롤러 코드는 TypeScript를 변환해 실행했고 외부 API·DB·타이머를 대역으로 교체했다. 실제 SQLite 파일이나 Supabase에는 쓰지 않았다. 전체 서버를 가동한 HTTP 통합 침투 테스트는 아니다.
- 운영 도메인에 공격·부하·쓰기 요청을 보내지 않았다. 실제 배포 버전, 방화벽, WAF, Railway/Vercel 설정, 실제 Supabase 정책은 확인하지 않았다.
- npm audit는 Backend와 Frontend에서 시도했으나 npm 레지스트리 DNS 연결 실패로 완료하지 못했다. 의존성 전체에 대한 취약점 부재를 보장하지 않는다.
- 소스 코드를 수정하지 않았으며 보고서·재현 스크립트·결과 파일만 추가했다.

## 발견 사항

| ID | 위험도 | 문제 | 적용 조건 |
|---|---|---|---|
| F01 | 높음 | 추천마다 전체 벡터를 동기 계산하며 요청 제한이 없음 | 현재 Backend 코드 |
| F02 | 높음 | 크롤러의 강제 수집·메타 갱신·저장을 인증 없이 실행 | 크롤러가 공격자에게 접근 가능 |
| F03 | 중간 | 음수·0 페이지 크기로 건수 제한 우회 | 크롤러 SQLite/TypeORM 경로 |
| F04 | 중간 | 백그라운드 작업의 오류가 미처리 Promise 거부로 전파 | 트랜잭션 시작 등 DB 작업 실패 |
| F05 | 중간 | 카카오 크롤러가 완료 후에도 반복 타이머를 유지 | 대기열이 생기는 카카오 수집 |
| F06 | 중간 | 일반 조회가 내부/외부 작업으로 증폭되고 대기열 제한이 없음 | 크롤러 공개 조회 경로 |
| F07 | 낮음 | 관계없는 Vercel 사이트도 CORS 허용 | 현재 Backend CORS 설정 |
| C01 | 조건부 높음 | 내부 적재 경로가 비밀값 미설정 시 인증 없이 열림 | seed 구현이 있는 저장소 연결 시 |
| C02 | 조건부 중간 | 데이터에 섞인 임의 링크·이미지 주소를 허용 | 카탈로그/수집·배포 데이터 변조 권한 필요 |

### F01 — 추천 요청으로 서버 이벤트 루프 점유

근거: `Backend/src/app.ts:62`, `Backend/src/app.ts:81`, `Backend/src/lib/similarity.ts:143`.

공개 `POST /api/recommendations`는 요청마다 전체 카탈로그의 장르·태그·줄거리·제목·작가 벡터, 문서 빈도, TF-IDF와 정렬을 다시 계산한다. 60초 캐시는 목록에만 적용되며 계산 결과나 벡터를 캐시하지 않는다. 이 작업은 Node 메인 스레드에서 동기 실행되고 앱에는 요청 빈도·동시 계산 제한이 없다.

로컬 최종 재현에서는 작품 하나를 선택하고 결과를 1개만 요청해도 각각 **1,501.7 / 1,443.2 / 1,425.1ms**가 걸렸다. 같은 순간 예약한 0ms 타이머도 **1,501.8 / 1,443.2 / 1,425.2ms** 뒤에 실행됐다. 결과 개수를 줄여도 전체 계산 비용을 피하지 못한다. 운영 환경의 정확한 처리량은 측정하지 않았다.

공격자는 검색 API에서 유효한 작품 ID를 얻은 뒤 정상 형태의 작은 추천 요청을 반복할 수 있다. 같은 프로세스의 검색·상태 확인도 지연될 수 있고, 인스턴스 증설 비용도 증가할 수 있다. CORS는 직접 HTTP 요청에 대한 방어가 아니다.

수정: 카탈로그 로딩 시 특징 벡터와 IDF를 한 번 생성해 재사용하고, 사용자 요청에서는 프로필 및 후보 점수만 계산한다. 무거운 연산은 별도 worker로 옮기고 대기열 상한을 둔다. 요청 빈도 제한·동시 작업 상한·기한 초과와 과부하 시 429/503 응답을 함께 적용한다. 배포의 기존 WAF 제한 유무도 확인해야 한다.

### F02 — 크롤러 관리 기능의 인증 부재

근거: `KOREA_WEBTOON_API/src/index.ts:36`, `KOREA_WEBTOON_API/src/routes/update/functions/createUpdateMethod.ts:20`, `:39`, `:74`, `KOREA_WEBTOON_API/src/routes/enrich/naver.ts:44`, `KOREA_WEBTOON_API/src/routes/webtoon-by-id.ts:47`.

다음 경로에 인증/관리자 권한 검사가 없다.

- `PUT /update/naver?force=true`
- `PUT /update/kakao?force=true`
- `PUT /update/kakao-page?force=true`
- `PUT /enrich/naver`
- `GET /webtoons/:id?persist=true`

`force=true` 또는 `force=1`은 6시간 수집 간격을 우회한다. 실행 중 작업 잠금도 없다. 최근 갱신 기록이 있는 대역 DB로 확인했을 때 일반 요청은 스킵됐으나, 인증 헤더 없는 강제 요청 2개는 모두 200을 반환하면서 **동시에 2개 트랜잭션**을 시작했다.

단건 GET의 `persist=true`도 인증 없이 저장 함수를 호출했다. 대역을 사용한 동일 GET 2회에서 보강 2회·저장 2회를 확인했다. 이는 플랫폼에서 가져온 값을 갱신하게 하는 권한 문제이며, 공격자가 HTTP 본문으로 임의의 DB 내용을 직접 지정할 수 있다는 의미는 아니다.

영향: 대규모 재수집·트랜잭션 경합·외부 API 차단·메타데이터의 비승인 갱신. 크롤러가 내부망/로컬 전용이면 인터넷 공격 경로는 제한된다. 현재 Backend는 크롤러와 분리되어 있으므로 두 서비스를 혼동하면 안 된다.

수정: 크롤러 관리 경로를 사설망 또는 인증된 관리 API로 이동한다. 비밀값 누락 시 요청 거부 또는 서버 시작 실패로 처리하고, 플랫폼별 단일 작업 잠금과 전체 동시성 제한을 둔다. 조회 GET에서 저장 기능을 제거한다.

### F03 — 페이지 및 배치 건수 제한 우회

근거: `KOREA_WEBTOON_API/src/routes/webtoons.ts:122`, `:171`, `KOREA_WEBTOON_API/src/routes/enrich/naver.ts:46`, `KOREA_WEBTOON_API/src/modules/naver/enrichNaverMetadataBatch.ts:29`.

목록은 `perPage > 100`만 거부한다. 문자열을 실제 양의 정수로 파싱하지 않아 `perPage=-1`, `perPage=0`이 통과한다. 로컬 핸들러 재현에서 각각 200이 반환되고 `.take(-1)`, `.take(0)`이 전달됐다.

설치된 TypeORM 0.3.20의 `createLimitOffsetExpression()`에서 SQLite `.take(-1)`은 `LIMIT -1`이 되며, `.take(0)`은 limit가 거짓 값이라 LIMIT 구문이 생략된다. SQLite에서 두 경우 모두 전체 행 반환으로 이어진다. 별도 메모리 DB 123행으로 `LIMIT 100`은 100행, `LIMIT -1` 및 LIMIT 생략은 123행임을 확인했다. 실제 크롤러 DB 전체를 HTTP로 내려받는 테스트는 하지 않았다.

배치도 `Math.min(Number(limit), 500)`만 적용하므로 `limit=-1`이 통과해 `.take(-1)`로 전달된다. `delayMs=0`·음수도 거부하지 않아 요청 간격을 사실상 제거할 수 있다. 재현에서 `limit=-1, delayMs=0`이 그대로 전달됐다.

영향: 의도한 최대 건수를 넘어 대량 응답 및 대량 외부 조회·쓰기를 유발한다. 공개 카탈로그이므로 그 자체를 비밀정보 유출로 분류하지 않는다.

수정: 쿼리의 단일 문자열 여부, 유한한 정수 여부, 하한·상한을 먼저 검증한다. 목록은 1~100, 보강 배치는 1~500 등으로 제한하고 delay에도 서버가 정한 하한·상한을 적용한다. 배열·객체 쿼리, 음수·0·소수·NaN·Infinity를 400으로 거부한다. page도 양의 정수 및 합리적 상한을 적용한다.

### F04 — DB 실패 시 처리되지 않는 비동기 오류

근거: `KOREA_WEBTOON_API/src/routes/update/functions/createUpdateMethod.ts:25`, `:72`, `:74`, `:76`, `:106`.

수집 작업을 비동기 즉시 실행 함수로 시작하고 그 Promise를 await하거나 catch하지 않는다. `startTransaction()`은 내부 try 바깥에 있다. catch 안의 rollback·상태 저장, finally의 release도 실패하면 미처리 거부가 된다. 라우트 시작 부분의 DB 조회·저장 역시 바깥 try가 없고 Express 4에 Promise 오류를 전달하는 래퍼가 없다.

대역 `startTransaction()`이 실패하도록 하자 응답은 200이었지만 **unhandledRejection**이 발생했다. 검증 프로세스에서 해당 이벤트를 받아 기록했다. 일반적인 미처리 거부 종료 정책이면 프로세스가 종료될 수 있다. 실제 프로세스 종료 및 운영 DB 경합은 실행하지 않았으므로, 단 한 요청으로 반드시 종료된다고 단정하지 않는다.

F02의 중복 실행은 DB 오류 발생 가능성을 높인다. 수정: 작업 실행 Promise를 관리하고 최상위 catch/finally에서 모든 오류와 자원 반환을 처리한다. `startTransaction()`도 보호 범위 안으로 이동하고, Express 4 라우트 오류를 `next(error)`로 전달한다. 작업 큐에 실패 상태와 재시도 정책을 둔다.

### F05 — 카카오 수집 대기열의 반복 타이머 누수

근거: `KOREA_WEBTOON_API/src/modules/kakao/index.ts:67`, `:78`, `:80`, `:87`.

동시 요청 수가 많으면 `setInterval()`로 대기한다. Promise가 resolve되어도 `clearInterval()`을 호출하지 않아 수집 완료 후에도 콜백과 클로저가 계속 남는다. 티켓 요청 실패 시 `queue -= 1`을 finally에서 수행하지 않는 점도 대기열 정체를 악화시킨다.

네트워크와 타이머를 대역으로 바꾸고 작품 14개로 실제 수집 함수를 실행했다. 작업이 정상 종료된 후에도 **생성된 타이머 3개가 모두 활성 상태**였다. 실제 반복 타이머나 플랫폼 요청은 만들지 않았다.

영향: 반복 수집할수록 주기적 콜백과 메모리가 누적된다. 특히 F02와 연결되면 외부 사용자가 반복 수집으로 자원 소모를 가속할 수 있다.

수정: 폴링 타이머 대신 명시적인 작업 큐/세마포어를 사용하고, 요청 완료·실패·취소 모두에서 finally로 슬롯을 반환한다. 각 작업의 전체 기한과 대기열 크기도 제한한다.

### F06 — 공개 조회가 내부 요청과 외부 수집으로 증폭

근거: `KOREA_WEBTOON_API/src/routes/webtoons.ts:103`, `KOREA_WEBTOON_API/src/routes/health-check.ts:25`, `KOREA_WEBTOON_API/src/routes/webtoon-by-id.ts:50`, `KOREA_WEBTOON_API/src/modules/enrich/enrichWebtoonMeta.ts:51`, `KOREA_WEBTOON_API/src/modules/kakao/functions/findKakaoCardMeta.ts:68`, `KOREA_WEBTOON_API/src/modules/kakao-page/functions/kakaoPageRequestQueue.ts:15`.

목록 요청은 파라미터 검증보다 먼저 `/health-check`를 호출하고, health-check는 플랫폼별 갱신 PUT 3개를 호출한다. 잘못된 sort로 최종 400이 되는 요청도 대역 health 호출을 1회 발생시켰다. 즉, 목록 요청 하나가 내부 HTTP 호출 4개로 증폭될 수 있다. 이 두 self-call 경로에는 명시적 axios timeout도 없다. 갱신이 6시간 제한으로 스킵되더라도 HTTP 및 DB 작업은 남는다.

단건 조회는 enrich가 기본 true다. 네이버는 상세 정보·회차 수를 매번 요청하고, 카카오는 작품을 찾을 때까지 최대 8개 목록을 순회한다. 기존 메타가 채워져 있어도 이 외부 요청을 건너뛰지 않는다. 같은 ID 요청을 합치거나 결과를 캐시하지 않는다.

카카오페이지 요청은 전역 Promise 체인으로 간격을 유지하지만, 대기열 길이와 전체 대기 시간을 제한하지 않는다. 입력 요청이 처리보다 빠르게 들어오면 대기가 계속 쌓인다. 브라우저 요청 취소도 이 작업들을 중단하지 않는다.

영향: 적은 공개 요청이 많은 내부 연결·외부 API 호출·미완료 작업으로 늘어난다. 네트워크 정체와 플랫폼 차단이 조회 가용성에 직접 영향을 준다. 타임아웃 미설정만으로 느린 응답을 공격자가 임의 생성할 수 있다는 뜻은 아니며, 외부/내부 의존성 지연이 겹칠 때 영향이 커진다.

수정: 조회·상태 확인을 읽기 전용으로 만들고 수집은 인증된 예약 작업으로 분리한다. 상세 정보는 TTL 캐시·요청 합치기를 적용한다. 외부 요청 timeout, 전체 작업 기한, 대기열 상한, 취소 전파 및 과부하 거부를 구현한다. 플랫폼 API 클라이언트의 기존 30초 timeout은 유지하되 self-call에도 별도 한도를 적용한다.

### F07 — 모든 Vercel 하위 도메인을 신뢰하는 CORS

근거: `Backend/src/app.ts:21`.

명시적 `CORS_ORIGIN` 목록과 별도로 `https://*.vercel.app` 전체를 허용한다. 소유 프로젝트가 아닌 `https://security-audit-unrelated.vercel.app`을 Origin으로 전달했을 때 동일한 `Access-Control-Allow-Origin`을 반환했다.

공격자가 관리하는 Vercel 페이지에서도 브라우저로 API를 호출하고 결과를 읽을 수 있다. 다만 현재 데이터는 공개이고 credential 허용이나 사용자 계정이 없어, 이를 계정 탈취·개인정보 유출로 분류하지 않는다. F01의 악용 편의와 의도한 origin 경계 이탈을 고려한 낮음 등급의 설정 결함이다.

수정: 소유한 운영/검증 도메인만 정확히 허용한다. Preview가 필요하면 해당 프로젝트의 검증된 도메인만 별도로 관리한다. 별도로 인증과 호출량 제한을 적용한다.

## 조건부 위험

### C01 — seed 저장소 연결 시 인증이 기본 허용

근거: `Backend/src/app.ts:84`.

`CRON_SECRET`이 존재할 때만 헤더를 비교하므로, 비밀값이 없으면 `/internal/seed-webtoons`가 인증 없이 동작한다. 입력도 배열이 비어 있지 않은지만 검사해 잘못된 항목이 seed 함수로 전달된다.

현재 `src/index.ts`가 연결하는 로컬 저장소에는 seed가 없어 이 경로는 **등록되지 않는다**. 실제 구성으로 404임을 확인했다. 테스트에서만 seed 대역을 연결하고 CRON_SECRET을 제거하자 인증 없는 요청이 200으로 처리되고 필수 필드가 없는 항목도 전달됐다. 이 결과를 현재 운영 DB 임의 수정 가능으로 해석하면 안 된다.

수정: 쓰기 저장소가 필요 없다면 경로를 삭제한다. 유지한다면 필수 비밀값·권한 검증을 먼저 적용하고, 비밀값 누락 시 거부한다. 항목별 스키마·필드 길이·배열 개수·전체 건수 제한도 둔다.

### C02 — 카탈로그 데이터가 링크와 렌더링 입력으로 그대로 사용

근거: `Backend/src/lib/localCatalog.ts:21`, `Backend/src/lib/mapWebtoon.ts:30`, `Frontend/src/components/Recommendations.tsx:124`, `Frontend/src/components/Cover.tsx:8`.

서버는 url이 문자열인지만 확인하고 허용한 HTTPS 호스트인지 확인하지 않는다. thumbnail·authors·tags 등도 실제 타입과 길이를 충분히 검사하지 않는다. 프론트는 API 응답에 대한 런타임 검증 없이 이를 링크·이미지·배열 메서드에 사용한다.

임시 JSON 한 건으로 `https://example.invalid/phishing`과 추적 이미지 주소가 저장소 검증을 통과함을 확인했다. 실제 카탈로그는 수정하지 않았다. 현재 두 카탈로그의 작품 URL 6,010개는 모두 네이버/카카오 HTTPS 주소이고, 이미지도 확인된 두 CDN의 HTTPS 주소였다.

공격자가 카탈로그·수집 파이프라인·배포 결과 또는 API 응답을 변조할 수 있을 때 공식 작품 버튼을 피싱 사이트로 연결하거나 추적 이미지를 넣을 수 있다. 비정상 배열·문자열은 추천/화면 오류를 유발할 수 있다. 외부 사용자가 현재 API만으로 카탈로그 파일을 수정하는 경로는 확인하지 못했다. React 19의 URL/텍스트 보호를 고려해 이를 입증된 저장형 XSS로 분류하지 않는다.

수정: 수집·파일 로딩·응답 경계에서 스키마를 검증한다. 작품 링크는 플랫폼별 정확한 HTTPS hostname과 경로 규칙을 검증하거나 ID에서 생성한다. 이미지도 승인된 CDN만 허용하고 배열·문자열 길이를 제한한다.

## 의존성: 알려진 취약 버전과 실제 도달 가능성

크롤러 잠금 파일 및 설치본에서 axios 1.7.2, Express 4.19.2, TypeORM 0.3.20을 확인했다. 잠금 파일에는 path-to-regexp 0.1.7, qs 6.11.0, body-parser 1.20.2, send 0.18.0, serve-static 1.15.0도 남아 있다. 다음은 공식 공지와 비교한 예시이며 전체 목록이 아니다.

| 라이브러리 | 공지와 수정 버전 | 이 프로젝트에서의 판단 |
|---|---|---|
| axios 1.7.2 | [CVE-2024-39338](https://github.com/advisories/GHSA-8hc4-vh64-cxmj), 수정 1.7.4 | 버전 해당. 요청 URL을 공격자가 임의 지정하는 앱 경로는 확인하지 못함 |
| axios 1.7.2 | [CVE-2025-27152](https://github.com/axios/axios/security/advisories/GHSA-jr5f-v2jv-69x6), 수정 1.8.2 | 버전 해당. baseURL을 우회하는 공격자 입력 경로는 확인하지 못함 |
| Express 4.19.2 | [CVE-2024-43796](https://github.com/expressjs/express/security/advisories/GHSA-qw6h-vgh9-j6wx), 수정 4.20.0 | 현재 앱의 redirect 목적지는 고정 `/api-docs`라 해당 XSS 공격 경로는 확인하지 못함 |
| path-to-regexp 0.1.7 | [CVE-2024-45296](https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-9wv6-86v2-598j), 0.1 계열 수정 0.1.10 | 버전 해당. 현재 명시적 라우트에서 문제의 `/:a-:b` 형식은 확인하지 못함 |
| qs 6.11.0 | [CVE-2025-15284](https://github.com/ljharb/qs/security/advisories/GHSA-6rw7-vpxm-498p), 수정 6.14.1 | 기본 parameterLimit이 완화하는 낮은 위험. 공지도 기본 설정의 실질 DoS 위험을 미미하다고 설명 |
| qs 6.11.0 | [CVE-2026-82417](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g), 수정 6.16.0 | parse 결과를 취약한 stringify로 재직렬화하는 앱 경로는 확인하지 못함 |

표의 수정 버전은 각 개별 공지의 최소 수정 버전이다. 이를 현재 시점에 충분히 안전한 최종 권장 버전으로 사용하면 안 된다. 유지보수되는 버전으로 업데이트하고 잠금 파일 전체를 다시 감사해야 한다. Backend의 잠금 파일은 Express 4.22.3, qs 6.16.0, path-to-regexp 0.1.13으로 크롤러와 다르다. 프론트는 React 클라이언트 앱이며 React Server Components 서버가 없으므로, 관련 서버 CVE를 버전명만 보고 적용하지 않았다.

## 추가 운영 보완 사항

1. **브라우저 방어 헤더**: Frontend/vercel.json에 CSP, frame-ancestors/X-Frame-Options, nosniff, Permissions-Policy 설정이 없다. 앱에도 별도 헤더 구성이 없다. CSP와 프레임 제한을 배포 환경에서 설정하고 실제 응답을 확인한다. 누락만으로 XSS가 입증되는 것은 아니며, 호스팅 계층이 제공하는 HSTS/헤더 상태는 이번 점검에서 확인하지 않았다.
2. **컨테이너 권한**: Backend/Dockerfile은 USER 지정을 하지 않아 해당 이미지의 기본 root 사용자로 실행된다. 비특권 사용자로 실행하고 데이터 파일을 읽기 전용으로 둔다. 원격 코드 실행 경로 자체는 발견하지 못했다.
3. **비밀값**: Backend/.env에 service_role JWT 형식의 값이 있다. 키의 유효성/폐기 여부는 외부에서 확인하지 않았고 원문을 출력하거나 보고서에 복사하지 않았다. 파일은 권한 600이며 .gitignore와 .dockerignore의 제외 대상이다. 확인한 소스·프론트 번들·문서에서 JWT/비밀키 표식은 발견되지 않았다. 로컬 파일 존재만으로 유출을 단정하거나 무조건 키 교체가 필요하다고 판단하지 않는다. 실제 Git 이력·배포 환경·공유 권한은 별도 확인이 필요하다.
4. **Supabase**: 마이그레이션은 RLS 활성화 및 anon/authenticated의 SELECT 정책만 정의한다. 공개 웹툰 목록 읽기는 의도된 동작이고 무단 쓰기 정책은 발견하지 못했다. 현재 실행 서버는 Supabase를 사용하지 않는다. 로컬 config.toml의 개발용 인증 설정을 실제 클라우드 운영 설정이라고 해석하지 않았다.
5. **관측과 반복 검증**: 크롤러 공개 관리 경로 접근, 429, 추천 CPU 시간, 대기열 길이, 작업 실패와 미처리 오류를 기록·관측한다. 전체 의존성 감사는 레지스트리에 연결 가능한 환경에서 다시 수행한다.

## 우선 수정 순서

1. 현재 Backend: 추천 벡터 사전 계산·캐시, worker 및 호출량/동시성 제한 (F01).
2. 크롤러가 공개되어 있다면 관리 경로 접근 통제·비밀값 필수화·단일 작업 잠금 (F02).
3. 크롤러 입력 정수 범위와 delay 검증, 비동기 오류 처리, 대기열/타이머 교체 (F03~F05).
4. 읽기 경로에서 수집·저장 분리, 외부 요청 캐시·기한·대기열 상한 (F06).
5. CORS 도메인 제한, 잠재 seed 코드 정리, 데이터 스키마·URL 검증 및 의존성 업데이트 (F07, C01~C02).

## 재현 산출물

동일 폴더의 `verify.mjs`와 `results.json`에 재현 코드와 최종 측정값을 보관했다. 프로젝트 루트에서 실행한다.

```sh
node --import ./Backend/node_modules/tsx/dist/loader.mjs docs/security-audit-2026-10-16/verify.mjs
```

스크립트는 운영망에 접속하지 않고 실제 DB에 쓰지 않는다. 임시 JSON은 시스템 임시 디렉터리에 생성 후 삭제하며 결과 파일만 갱신한다. 최신 검증은 종료 코드 0으로 완료됐다. 타이밍 수치는 컴퓨터 성능과 부하에 따라 달라진다.

이 보고서는 확인 가능한 로컬 소스와 제한된 재현의 결과다. 취약점이 모두 발견되었다는 보장, 현재 운영 서비스의 침해 여부 판정, 운영 인프라 전체에 대한 감사 결과는 아니다.
