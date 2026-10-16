# 보안 보완 버전 실행·배포 안내

2026-10-16. 코드 보완과 로컬 검증에 대한 안내이며 운영에 배포되었다는 의미는 아니다.

## Backend

Backend 디렉터리에서 Node.js 22.12+로 다음을 실행한다.

```sh
npm ci
npm test
npm run build
npm start
```

프로덕션에는 NODE_ENV=production, PORT, CORS_ORIGIN을 설정한다. CORS_ORIGIN은 실제 프론트엔드의 정확한 HTTPS origin을 쉼표로 구분한다. 예시 도메인을 그대로 배포하지 않는다. wildcard·경로·끝 슬래시는 허용하지 않는다. 런타임에는 Supabase 키가 필요 없다. 별도 적재 CLI에 필요한 키만 작업 환경에 주입한다.

TRUSTED_PROXY_CIDRS는 기본 미설정(false)이다. Railway 직접 URL과 Vercel 경유 경로의 신뢰 가능한 프록시 IP/CIDR을 확인한 뒤에만 설정한다. 임의의 X-Forwarded-For를 신뢰하는 true 설정으로 우회하지 않는다. 설정 전에는 프록시를 공유하는 사용자의 IP 제한이 합쳐질 수 있다. 두 진입 경로를 모두 검증해야 한다.

현재 기본 제한은 추천 IP별 burst 3, 분당 30회 회복이며 전체 API IP별 burst 60, 분당 120회 회복이다. 각 제한의 IP 상태 저장소는 최대 10,000개이고 가득 차면 거부한다. 여러 인스턴스라면 프로세스별 제한 외에 신뢰 가능한 진입 계층의 서비스 전체 제한을 추가한다. 인스턴스별 추천 worker는 1개, 활성 작업 외 대기열 8개, 요청 기한은 5초다. 제한값은 실제 트래픽·공용망·인스턴스 자원 검증 후 변경한다.

시작 시 카탈로그 검증과 worker 인덱스 준비를 완료한 뒤 listen한다. `/health`는 생존 상태, `/ready`는 worker 준비 상태다. 프로세스 시작 여유 시간은 초기 인덱스 생성에 맞춰 설정하고, 일시적인 worker 재시작을 즉시 컨테이너 재시작으로 연결하지 않는다. 과부하는 429/503, 잘못된 JSON은 400, 본문 한도 초과는 413이다. 내부 HTTP seed 경로는 제거됐다.

카탈로그 변경은 `npm run sync:catalog`로 검증 후 원자적으로 교체하고 재배포/재시작한다. 기존 파일에 직접 덮어쓰는 방식은 피한다. Docker 이미지는 비특권 node 사용자로 실행하고 root 소유의 카탈로그를 읽기 전용 권한으로 둔다. 이미지 실행 검증은 Docker 사용 가능한 환경에서 수행한다.

## Frontend

Frontend 디렉터리에서 `npm ci`, `npm test`, `npm run build`를 실행하고 Vercel에 배포한다. VITE_API_URL을 사용한다면 실제 Backend의 HTTPS origin을 지정한다. 같은 origin `/api` 프록시를 사용하면 이 변수는 비워 둘 수 있다. 현재 vercel.json의 목적지가 실제 배포 Backend와 일치하는지 확인한다.

nosniff, 프레임 차단, Referrer-Policy, Permissions-Policy와 최소 CSP는 강제 적용한다. 더 엄격한 전체 CSP는 Report-Only로 설정했다. 실제 배포에서 브라우저 콘솔과 이미지·폰트·WebGL·API 연결을 확인한 후 허용 목록을 확정해 강제 정책으로 옮긴다. 별도 외부 보고 수집기는 구성하지 않았으므로 CSP 위반은 우선 브라우저에서 확인한다. 호스팅의 HTTPS/HSTS는 운영 응답에서 확인한다.

## Crawler

KOREA_WEBTOON_API는 Node.js 22.12+, npm 및 package-lock.json을 사용한다. 이전 yarn.lock은 폐기했다. `.npmrc`의 legacy-peer-deps는 기존 lint 설정의 peer 제약을 위해 사용하며 잠금 파일을 유지한다. `npm ci`, `npm test`, `npm run typecheck`를 실행한다. 플랫폼이 다른 node_modules를 재사용하지 않는다.

기본 BIND_HOST는 127.0.0.1이고 관리 HTTP는 비활성화다. Railway 등에서 필요한 경우 **사설 서비스**로 격리한 뒤 BIND_HOST=0.0.0.0을 명시한다. 공개 인터넷에 관리 경로를 노출하지 않는다.

관리 기능이 필요하면 ENABLE_ADMIN_HTTP=true 및 32자 이상의 무작위 CRAWLER_ADMIN_SECRET을 프로세스 환경에 주입한다. 키가 없으면 시작에 실패한다. 키를 프론트 환경 변수·URL·로그에 넣지 않는다. 요청은 `x-crawler-secret` 헤더로 인증한다. 기존 로컬 .env를 자동 로딩하지 않으므로 환경 주입 방식을 확인한다.

| 경로 | 보완 후 동작 |
|---|---|
| GET /health-check | 저장된 상태만 읽음; 수집을 시작하지 않음 |
| GET /webtoons, /webtoons/:id | 저장된 작품만 반환; enrich/persist 쿼리는 거부 |
| PUT /update/naver, /update/kakao, /update/kakao-page | 관리 인증 필요; 202와 job 반환; 중복 실행은 409 |
| PUT /enrich/naver | 인증된 보강 작업; limit 1~500, delayMs 200~5,000 |
| GET /internal/jobs/:id | 인증된 작업 상태 조회; 이력 최대 100개, 재시작 시 초기화 |
| /api-docs | 관리 인증 필요; 기본 비활성화 |

SQLITE_PATH를 영속 볼륨의 실제 SQLite 파일로 지정한다. 모든 쓰기 작업은 인접한 `.job.lock` 파일을 원자적으로 획득해 직렬화한다. 같은 볼륨에 대해 하나의 수집 서비스만 운영한다. CLI 보강·export·시작 시 스키마 준비도 같은 잠금을 사용한다.

수집 작업의 기본 기한은 15분이다. 기한 초과 시 외부 HTTP와 대기를 취소하지만, 실제 작업이 끝나기 전에 잠금을 해제하지 않는다. 실패한 작업의 상태와 health를 확인한다. 롤백에 실패하면 DB 연결을 폐쇄하므로 원인 확인 후 재시작한다. 프로세스 강제 종료 후 남은 잠금은 **해당 볼륨을 사용하는 모든 작업이 종료됐음을 확인한 뒤**에만 제거한다. 시간만 보고 자동으로 지우지 않는다.

기존 health-check 호출 기반 예약 수집은 아래 새 스크립트로 전환한다. 이 스크립트는 플랫폼을 하나씩 실행하고 완료를 확인한다. 운영 키는 스케줄러의 비밀 환경 변수로 주입한다.

```sh
# 환경에 CRAWLER_BASE_URL과 CRAWLER_ADMIN_SECRET을 주입한 다음, 프로젝트 루트에서:
node scripts/trigger-crawler.mjs
```

스크립트의 URL은 HTTPS 또는 loopback/사설 Railway 호스트만 받으며 리다이렉트를 따르지 않는다. 409나 실패는 스케줄러 실패로 보고되어야 한다. 스케줄러 자체의 생성·운영 키 설정·실제 수집은 이번 로컬 수정에서 수행하지 않았다.

## 반영 순서와 복구

1. 배포 버전·설정·카탈로그와 SQLite를 백업한다. 실제 origin, 프록시, 복제본 수를 확인한다.
2. 공개 크롤러 관리 경로 접근을 먼저 차단한다. 신규 인증 설정을 주입한다.
3. Backend를 배포하고 두 진입 경로의 정상 요청·429·503·ready를 확인한다.
4. 사설 크롤러와 예약 수집을 함께 전환하고 실제 수집 주기까지 한 번 확인한다.
5. Frontend를 배포하고 검색·추천·CSP·허용 CDN을 확인한다.

문제가 있으면 해당 변경을 복구하되 관리 경로 비공개 및 요청 제한은 유지한다. 과거 무인증 관리 서버를 공개 상태로 되돌리지 않는다. 카탈로그 검증 실패 시 직전 검증본으로 복구한다.

로컬 테스트·감사 결과와 실제 운영 반영은 구분한다. 운영 도메인 설정, 프록시 검증, 배포, 스케줄러 전환, 전체 CSP 강제 및 운영 모니터링 확인 전에는 운영 보완 전체를 완료로 표시하지 않는다.
