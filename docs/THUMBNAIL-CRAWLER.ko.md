# 전체 작품 썸네일 수집 엔진

**`Backend/data/webtoons.json`의 네이버·카카오웹툰 전체 작품**에 등록된 썸네일 URL을 읽어 프로젝트 루트의 `이미지` 폴더에 저장한다. **카카오페이지는 수집하지 않는다.** 카카오는 `thumbnail` 배열에 있는 캐릭터 A/B와 배경 이미지도 각각 저장한다. 작품 목록을 새로 크롤링하는 명령과는 별개이며, JSON에 현재 들어 있는 URL을 수집한다.

2026-11-07 운영 API에서 네이버 **4,161작품**, 카카오 **3,211작품**, 카카오페이지 **0작품**, 합계 **7,372작품**을 확인했다. 같은 날 이 작업 폴더의 `Backend/data/webtoons.json`에는 네이버 **2,799작품**, 카카오 **3,211작품**, 합계 **6,010작품 / 12,432이미지**가 들어 있었다. 운영 데이터와 로컬 파일의 버전이 다르므로 실행 전 `--dry-run`으로 해당 파일의 실제 수량을 확인한다. 엔진은 수량을 하드코딩하거나 원본 JSON을 덮어쓰지 않으며, 파일을 갱신하면 다음 실행부터 갱신된 전체 작품을 읽는다.

## 실행

Node.js 22.12 이상을 사용한다. macOS·Linux·Windows에서 프로젝트 루트를 기준으로 실행한다.

```sh
# 최초 한 번 (크롤러 의존성이 이미 설치되어 있으면 생략)
npm --prefix KOREA_WEBTOON_API ci

# 전체 대상 확인: 다운로드와 파일 변경 없음
node scripts/crawl-thumbnails.mjs --dry-run

# Backend/data/webtoons.json 전체 수집: 기본 저장 위치는 항상 프로젝트 루트/이미지
node scripts/crawl-thumbnails.mjs
```

크롤러 폴더에서도 실행할 수 있다. 기본 JSON과 이미지 저장 위치는 실행 폴더와 관계없이 프로젝트 위치를 기준으로 정한다.

```sh
npm --prefix KOREA_WEBTOON_API run crawl:thumbnails
```

기본 원본은 항상 `Backend/data/webtoons.json`이다. 명시한 상대 경로는 명령을 실행한 폴더 기준이며, 다른 JSON은 `--catalog`, SQLite를 따로 확인할 때만 `--db`로 파일을 지정한다. `SQLITE_PATH` 환경 변수가 있어도 기본 JSON 원본은 바뀌지 않는다.

```sh
# 플랫폼 선택, 일부 작품만 시험 수집
node scripts/crawl-thumbnails.mjs --provider NAVER --limit 5
node scripts/crawl-thumbnails.mjs --provider NAVER,KAKAO

# 기본 JSON 원본을 명시적으로 지정
node scripts/crawl-thumbnails.mjs --catalog Backend/data/webtoons.json

# 플랫폼별 export JSON도 지원 (카카오페이지 항목은 제외)
node scripts/crawl-thumbnails.mjs --catalog data/webtoons/webtoons-kakao.json

# 선택: 별도 SQLite 파일의 네이버·카카오만 수집
node scripts/crawl-thumbnails.mjs --db /absolute/path/to/database.sqlite

# 요청 조정 (전체 요청 시작 사이 최소 500ms, 동시 2개)
node scripts/crawl-thumbnails.mjs --concurrency 2 --delay-ms 500 --timeout-ms 20000 --retries 2

# 저장 위치 변경 또는 기존 파일 강제 갱신
node scripts/crawl-thumbnails.mjs --output ./이미지
node scripts/crawl-thumbnails.mjs --force

node scripts/crawl-thumbnails.mjs --help
```

`--limit`은 이미지 수가 아닌 작품 수다. 생략하면 네이버·카카오의 모든 작품을 읽는다. JSON에 카카오페이지 항목이 섞여 있어도 제외하며, `--provider KAKAO_PAGE`도 거부한다. 원본 JSON 파일이 없거나 잘못되었으면 오류로 종료하며 다른 DB나 원격 데이터로 대체하지 않는다. Supabase 연결은 필요하지 않다.

## 저장 형태와 결과

```text
이미지/
  .gitkeep
  manifest.json
  NAVER/
    naver_641253/
      01-<URL 해시>.jpg
  KAKAO/
    kakao_3090/
      01-<URL 해시>.png
      02-<URL 해시>.png
      03-<URL 해시>.jpg
```

폴더는 플랫폼과 작품 ID, 파일명은 배열 순서(1부터)와 URL 해시로 구성한다. 제목에 특수문자가 있어도 저장 경로에 영향을 주지 않는다. URL이 바뀌면 새 파일로 받으며 이전 이미지는 자동 삭제하지 않는다. 확장자는 응답 바이트로 판별한다. JPEG·PNG·WebP·GIF·AVIF를 지원한다.

`manifest.json`에는 **해당 실행에서 선택한 대상**의 작품 ID, 제목, 원본 URL, 파일 상대 경로, 바이트 수, SHA-256 체크섬, 상태와 오류를 저장한다. 일부 플랫폼만 실행하면 manifest에는 그 실행 대상만 기록된다. 이전에 받은 다른 플랫폼의 파일은 유지된다.

| 필드/상태 | 의미 |
|---|---|
| `summary.works` / `images` | 대상 작품 수 / 중복 제거 후 등록된 이미지 URL 수 |
| `downloaded` | 이번 실행에서 다운로드한 이미지 |
| `skipped` | 정상 파일을 확인하고 재사용한 이미지 |
| `failed` | 다운로드 실패. 각 항목의 `error`에 원인 기록 |
| `missing` | 원본에 썸네일 URL이 없는 작품 |
| `pending` | 아직 처리하지 않은 이미지. 중단 후 재개 대상 |
| `state` | `running`, `completed`, `cancelled`, `failed` |

`state: completed`는 모든 대상을 처리했다는 뜻이다. 다운로드 성공 여부는 `summary.failed`, `summary.missing`도 함께 확인한다. 오류를 숨기거나 빈 이미지를 성공으로 기록하지 않는다.

## 재시도와 중단 후 재개

같은 명령을 다시 실행하면 이미 저장된 정상 파일을 재사용하고 실패·누락 파일을 다시 받는다. 이전 기록의 체크섬과 다른 파일은 다시 다운로드한다. URL이 없는 작품은 `missing`으로 기록한다. 삭제된 이미지의 404나 접근 거부 등 영구 오류는 기록하며, 만료된 URL을 작품 상세 페이지에서 새로 찾지는 않는다. 최신 URL이 필요하면 기존 작품 크롤러로 DB를 먼저 갱신한다.

기본 동시 다운로드는 4개, 모든 요청 시작 간 최소 간격은 200ms다. 각 시도 제한 시간은 20초이며 네트워크 오류, 408·425·429·5xx 응답은 최대 2회 추가 재시도한다. 재시도는 지수 대기를 적용하고 `Retry-After`를 최대 60초까지 반영한다. 이미지 하나의 최대 크기는 20MiB다. HTML 오류 페이지, 크기 초과, 응답 길이 불일치, 지원하지 않는 이미지 형식은 실패로 기록한다.

Ctrl+C 또는 SIGTERM을 받으면 진행 중인 요청을 취소하고 최종 결과를 저장한다. 수집 중에는 `progress.jsonl`에 25건 단위로 변경 기록을 추가하고, 정상 종료나 중단 시 `manifest.json`으로 합친다. 갑작스러운 종료 직전 기록되지 않은 파일도 다음 실행에서 파일 형식을 확인해 재사용한다. 다운로드는 임시 `.part` 파일을 만든 뒤 이름을 바꾸므로 미완료 파일을 정상 이미지로 취급하지 않는다.

같은 출력 폴더에 두 프로세스가 동시에 쓰지 않도록 `.crawl.lock`을 사용한다. 강제 종료나 정전 뒤 잠금이 남았다면 **해당 출력 폴더를 사용하는 수집 프로세스가 없는지 확인한 후** `이미지/.crawl.lock`을 삭제하고 다시 실행한다. `.part` 잔여물은 재개에 사용하지 않으며 수집이 중지된 상태에서 삭제할 수 있다.

원본 JSON은 읽기만 하며, `--db`로 지정한 SQLite DB도 읽기 전용으로 연다. 테이블 생성·마이그레이션·작품 수정이나 서비스 썸네일 경로 변경은 수행하지 않는다. 입력 파일이 없으면 오류로 종료하며 빈 DB를 만들지 않는다. 다운로드는 프로젝트가 사용하는 이미지 CDN의 HTTPS 주소만 허용하고 리다이렉트 주소도 검사한다. 수집 이미지는 루트 `.gitignore`에서 제외한다.

| 종료 코드 | 의미 |
|---|---|
| `0` | 성공 또는 dry-run 완료 |
| `1` | 잘못된 옵션·DB 오류·출력 잠금·디스크 오류 등 실행 오류 |
| `2` | 처리는 끝났지만 다운로드 실패 또는 썸네일 미등록 작품이 있음 |
| `130` | 사용자가 수집 중단 |

## 구현과 검증

- `scripts/crawl-thumbnails.mjs`: 루트 실행 진입점. 크롤러의 설치된 ts-node를 사용한다.
- `KOREA_WEBTOON_API/src/scripts/crawl-thumbnails.ts`: CLI 옵션, 대상 집계, 신호 처리, 종료 코드.
- `KOREA_WEBTOON_API/src/modules/thumbnails/source.ts`: SQLite 및 JSON 읽기.
- `KOREA_WEBTOON_API/src/modules/thumbnails/download.ts`: CDN 검증, 요청 제한, 재시도, 이미지 형식 확인.
- `KOREA_WEBTOON_API/src/modules/thumbnails/engine.ts`: 파일 저장, 결과 기록, 체크섬 검증, 재개 및 출력 잠금.
- `KOREA_WEBTOON_API/tests/thumbnails.test.ts`: 격리된 임시 DB와 모의 HTTP 응답을 사용하는 자동 테스트.

```sh
npm --prefix KOREA_WEBTOON_API run typecheck
npm --prefix KOREA_WEBTOON_API test
```
