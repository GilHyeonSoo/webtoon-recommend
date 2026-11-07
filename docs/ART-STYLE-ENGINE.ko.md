# Windows 로컬 작화 분석 엔진

프로젝트 루트의 `이미지/플랫폼/작품ID/사진`을 읽어 **YOLOv8-face 얼굴 크롭 → DINOv2 + WD-14 특징 추출 → 작품별 풀링 → UMAP → HDBSCAN → 유사 작품 인덱스**를 만든다. 분석 결과는 Windows 로컬 폴더의 UTF-8 JSON으로 저장한다. 이미지 수집이 끝나지 않아도 실행할 수 있으며, 다음 실행에서 추가·변경된 작품을 다시 분석한다.

기본 설정은 **i5-11400F / RAM 32GB / RTX 2070 Super 8GB**, FP16, 배치 32를 기준으로 한다. GPU 메모리가 부족하면 해당 모델의 배치를 32 → 16 → 8 → … → 1로 줄여 같은 입력부터 재시도한다. 실제 속도와 최대 배치는 입력·드라이버·다른 GPU 프로그램의 메모리 사용량에 따라 달라진다.

## 1. Windows 최초 설치

**Python 3.11 또는 3.12 64비트**와 NVIDIA 드라이버를 설치한다. Python Windows 설치 시 `py` 런처를 포함한다. 프로젝트 루트에서 PowerShell로 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-art-engine-windows.ps1
```

Python 3.12를 설치했다면 다음처럼 지정한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-art-engine-windows.ps1 -PythonVersion 3.12
```

`py` 런처가 없으면(Microsoft Store Python 등) PATH의 `python`이 3.11/3.12 64비트인지 확인해 사용한다.

프로젝트가 Google Drive 같은 동기화 폴더에 있으면 수 GB의 가상환경·모델을 로컬 디스크에 둔다. 지정한 경로는 사용자 환경변수 `ART_ENGINE_HOME` / `ART_OUTPUT_DIR`로 저장되고, `run-art-analysis.ps1`이 이후 자동으로 사용한다(명령에 `--models`/`--output`을 직접 주면 그 값이 우선).

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-art-engine-windows.ps1 -EngineHome C:\webtoon-art -OutputDir C:\webtoon-analysis
```

동기화 폴더의 이미지는 처음 읽을 때 클라우드에서 내려받으므로(장당 약 0.7초) 분석 전 해시 단계가 매우 느릴 수 있다. 이미지를 미리 병렬로 한 번 읽어 로컬 캐시에 받아 두면 크게 빨라진다.

설치 스크립트는 프로젝트의 `.venv-art` 가상환경에 PyTorch 2.7.1 / torchvision 0.22.1 **CUDA 12.6 휠**과 고정된 핵심 의존성을 설치하고, CUDA 확인 후 `.art-models`에 모델을 받는다. CUDA Toolkit을 따로 빌드할 필요는 없다. `doctor`에서 CUDA가 확인되지 않으면 NVIDIA 드라이버와 CUDA용 PyTorch 설치를 확인한다. CPU 설치가 필요할 때는 `-CpuOnly`를 사용한다.

모델 다운로드를 나중에 하려면 설치 시 `-SkipModels`를 지정하고 아래 `prepare`를 실행한다. 모델 다운로드에는 인터넷이 필요하며 수백 MB 이상의 모델과 PyTorch 패키지를 받는다. **분석 이미지 업로드나 원격 추론 API 호출은 없다.** 준비된 모델은 이후 로컬에서 읽는다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 prepare
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 doctor --device cuda
```

## 2. 입력 확인과 실행

```powershell
# 폴더만 집계. 모델 로딩·분석 결과 저장 없음
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 scan

# 먼저 20작품으로 실제 추론·크롭·군집화 확인
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --device cuda --limit 20

# 현재 존재하는 전체 작품 분석. 중단 뒤 같은 명령으로 재개
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --device cuda
```

`--limit`은 작품 수다. 시험 실행 시 `index.json`도 선택한 작품 범위로 만들어진다. 이후 전체 `analyze` 또는 `cluster`로 전체 인덱스를 만든다. 작품 1만 개는 설계 대상 규모이며, 작품 수를 1만 개로 제한하거나 부족한 입력을 만들어 채우지 않는다.

현재 수집기 폴더와 직접 작품 폴더 모두 지원한다. 중간 플랫폼 폴더는 작품으로 세지 않으며 이미지가 직접 들어 있는 폴더의 이름을 `work_id`로 사용한다.

```text
이미지/
  NAVER/
    naver_641253/
      01-....jpg
  KAKAO/
    kakao_2695/
      01-....png
      02-....png
      03-....jpg
  직접작품ID/
    cover.webp
```

`key`는 `KAKAO/kakao_2695`처럼 입력 루트 기준 상대 폴더 경로다. 서로 다른 플랫폼의 작품ID가 같아도 결과가 충돌하지 않는다. JPEG·PNG·WebP·GIF·AVIF·BMP·TIFF를 읽고 GIF 등 여러 프레임 파일은 첫 프레임만 사용한다. `.part`, 숨김 파일, 심볼릭 링크, 수집기의 manifest/progress/lock 파일은 분석하지 않는다. 이미지 루트에 작품 폴더 없이 놓인 사진은 오류로 안내한다.

## 3. 저장 위치

기본 결과 폴더는 **프로젝트 루트/작화분석결과**다. Windows의 별도 로컬 폴더로 저장하려면 `--output`을 지정한다. 아래 명령을 이후 재개·군집화·조회에서도 동일하게 사용한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --device cuda --output "C:\webtoon-analysis"
```

폴더 구조는 다음과 같다.

```text
작화분석결과/
  run.json                         # 최근 실행 설정, 장치, 개수, 상태, 오류
  features.json                    # 특징 데이터 변경 버전: 오래된 인덱스 조회 방지
  vocabulary.json                  # 풀링된 WD-14 general 벡터의 차원별 태그 이름
  vocabularies/<모델 서명>.json      # 모델 버전별 어휘 보존: 작품의 vocabulary 필드로 참조
  works/
    KAKAO/
      kakao_2695.json               # 작품별 원본·크롭·태그·벡터·풀링 결과
  plans/
    KAKAO/
      kakao_2695.json               # 검출·크롭 체크포인트
  crops/
    KAKAO/
      kakao_2695/
        <설정 서명>/
          <이미지 해시>-00-original.jpg
          <이미지 해시>-01-face.jpg
          <이미지 해시>-02-upper_body.jpg
  index.json                       # 군집, UMAP 좌표, 유사 작품 목록, 제외 작품
```

JSON은 이미지나 모델 바이너리를 포함하지 않는다. 크롭은 별도 JPEG, 모델은 `.art-models`의 가중치 파일로 보존한다. 결과와 모델 폴더, 가상환경은 Git에서 제외한다.

작품 JSON의 주요 필드는 다음과 같다.

| 필드 | 내용 |
| --- | --- |
| `key`, `work_id`, `provider` | 작품 식별자와 플랫폼 |
| `status` | `complete`, `partial`, `failed` |
| `sources` | 입력 상대 경로, SHA-256, 파일 크기 |
| `images` | 이미지 크기, 검출 수, 중복·오류 기록 |
| `samples[].bbox` | EXIF 방향을 적용한 원본의 `[x1,y1,x2,y2]` 픽셀 좌표 |
| `samples[].kind`, `method` | 원본·얼굴·상반신과 실제 검출/추정 방법 |
| `samples[].crop`, `crop_sha256` | 출력 루트 기준 크롭 경로 및 체크섬 |
| `samples[].dino` | 크롭별 L2 정규화된 DINOv2 384차원 벡터 |
| `samples[].tags` | general/character/rating 태그와 점수 |
| `pooled.dino` | 작품 대표 DINOv2 벡터 |
| `pooled.wd14_general` | 작품 대표 general 태그 점수 전체. 순서는 `vocabulary.json.general`과 같음 |
| `vocabulary` | 이 작품 벡터에 대응하는 모델 버전별 태그 어휘 파일 |
| `pooled.groups` | 원본·얼굴·상반신별 개수와 실제 반영 가중치 |
| `feature_signature`, `feature_digest` | 모델·전처리 호환성과 특징 데이터 무결성 확인값 |
| `runtime`, `analyzed_at`, `errors` | 실제 정밀도·장치·분석 시각·실패 원인 |

`index.json.items["KAKAO/kakao_2695"]`에는 `cluster`, `membership_probability`, `umap`, `neighbors`, 작품 JSON 경로가 들어 있다. `cluster: -1`은 HDBSCAN의 미분류/노이즈다. `membership_probability`는 해당 밀도 군집의 소속도이며 작화 평가 점수나 정답 확률이 아니다. 유사도는 원래 결합 벡터의 cosine similarity로 계산한다.

## 4. 크롭·특징·풀링 정책

- 투명 PNG는 흰색 배경에 알파 합성하고 EXIF 방향을 적용한다. 모델 입력 전 정사각형에 흰색 여백을 넣어 세로 썸네일을 억지로 늘리지 않는다.
- YOLOv8n-face로 얼굴을 검출하고, YOLOv8n person 검출을 보조로 사용한다. **YOLOv8-face는 얼굴 검출 모델이다. 상반신은 얼굴 아래로 확장하거나 person 박스의 상단 60%를 취한 추정 영역**이며 `estimated_from_face` / `estimated_from_person`으로 구분한다. 별도의 상반신 전용 학습 모델로 검출했다고 기록하지 않는다.
- 기본 얼굴 모델은 WIDERFace로 학습되었으므로 웹툰 그림체에서의 검출 품질을 실제 크롭으로 점검해야 한다. 얼굴이 안 잡혀도 원본 이미지를 분석한다. 웹툰에 맞게 학습한 Ultralytics 호환 YOLOv8-face 가중치가 있으면 `prepare --face-weights "C:\models\webtoon-face.pt"`로 교체할 수 있다. 이후 전체 `analyze`로 특징을 갱신한다.
- 이 버전은 **현재 썸네일 입력에서 인물 영역을 크롭**한다. 긴 회차 원본의 컷/패널 경계 분할 기능은 포함하지 않는다.
- 얼굴은 이미지당 최대 4개, 상반신은 최대 4개다. 원본은 항상 포함한다. 같은 작품 안에서 바이트가 동일한 이미지는 한 번만 추론한다.
- DINOv2는 `facebook/dinov2-small`의 CLS 토큰을 사용한다. WD-14는 v3 계열 `wd-swinv2-tagger-v3`의 safetensors를 PyTorch/timm으로 읽어 FP16 자동 혼합 정밀도로 추론한다. ONNX/CUDA 런타임을 별도로 설치하지 않는다. WD timm 가중치에 맞춰 **BGR 채널 및 mean/std 0.5** 전처리를 적용한다.
- 작품 안에서 원본·얼굴·상반신을 각각 평균 풀링한 뒤 **0.2 / 0.5 / 0.3** 비중으로 합친다. 없는 종류의 가중치는 나머지에 재분배한다. 얼굴 수가 많은 표지의 얼굴 비중이 자동으로 커지지 않는다. 검출이 전혀 없으면 원본 비중이 1이 된다. 배경만 있는 카카오 이미지가 얼굴·상반신 특징을 압도하지 않도록 종류별로 풀링한다.
- DINO와 WD general 벡터를 각각 정규화한 뒤 기본 **0.85 / 0.15** 비중으로 결합한다. 실제 연결 시 가중치의 제곱근을 곱해 cosine 내적에서 의도한 비중을 반영한다. 캐릭터 이름과 rating 태그는 기록만 하고 군집 벡터에는 사용하지 않는다.
- WD general 태그에도 의상·머리색·구도 같은 내용 특징이 포함된다. 결과는 작화 유사도를 탐색하는 출발점이며 전문가의 작화 분류 정답은 아니다. 내용 영향이 크면 `tag_weight`를 줄여 비교한다.

## 5. 군집화와 유사 작품 조회

```powershell
# 이미지 추론 없이 기존 작품 JSON으로 전체 군집·인덱스 재생성
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 cluster

# 유사 작품 목록 조회
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 similar kakao_2695

# 특정 작품만 추론하고 전체 군집화는 나중에 실행
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --work-id KAKAO/kakao_2695 --skip-clustering
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 cluster
```

UMAP은 cosine 기준 **기본 10차원**으로 줄인 뒤 HDBSCAN에 넘긴다. 시각화용 2차원으로 강제로 줄이지 않는다. 기본 `n_neighbors=30`, `min_dist=0`, `min_cluster_size=15`, `min_samples=5`, 시드 42다. 표본이 적으면 UMAP 차원·이웃 수만 유효 범위로 줄인다. 작품 수가 `min_cluster_size`보다 적으면 HDBSCAN을 생략하고 전부 `-1`로 기록한다. 1~2작품이거나 벡터가 전부 같으면 UMAP 좌표도 `null`로 남기고 이유를 기록한다.

군집화와 이웃 검색은 CPU에서 수행한다. 검색은 최대 128작품 단위로 질의해 1만×1만 전체 거리 행렬을 결과 파일이나 메모리에 한 번에 만들지 않는다. 기본 상위 유사 작품 수는 10이다. UMAP·HDBSCAN 학습 객체를 pickle로 저장하지 않으며, 작품이 추가되면 저장한 작품별 벡터로 `cluster`를 다시 실행한다. 군집 번호는 재학습 후 바뀔 수 있다.

## 6. 설정 변경

```powershell
Copy-Item .\tools\art-style-engine\config.example.json .\art-config.json
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --config .\art-config.json
```

JSON 안의 상대 입력·출력·모델 경로는 **항상 프로젝트 루트 기준**이다. `--input`, `--output`, `--models`도 같은 규칙을 사용하며 절대 경로도 지원한다. 입력·출력·모델 폴더는 서로 포함 관계가 될 수 없다. `--config` 파일 자체의 상대 경로만 명령 실행 위치 기준이다.

RAM 사용을 줄이려면 `work_window`를 8에서 2~4로 줄인다. GPU 메모리 부족이 반복되면 `--batch-size 16`을 지정한다. FP16 결과에 NaN이 발생하면 `--fp32 --batch-size 8`로 재실행한다. CUDA를 반드시 사용하려면 `--device cuda`를 지정한다. `auto`에서는 CUDA가 없으면 CPU FP32로 실행하고 실제 정밀도를 JSON에 기록한다.

검출 모델·전처리·풀링·정밀도가 바뀌면 특징 서명이 달라져 재추론한다. 배치 크기와 군집 설정만 바꾸면 기존 벡터를 재사용한다. `dino_weight` / `tag_weight` 변경은 추론 없이 `cluster --config ...`로 적용할 수 있다. 서로 다른 특징 서명의 작품이 섞이면 군집화를 거부하므로 전체 `analyze`를 먼저 실행한다.

## 7. 중단·실패·동시 수집

- 작품 JSON과 체크포인트는 임시 파일을 만든 뒤 교체한다. Ctrl+C 이전에 완료된 작품은 다음 실행에서 재사용한다. 추론 중 중단된 작품도 정상 크롭 체크포인트가 있으면 검출부터 반복하지 않는다.
- 변경 여부는 입력 파일의 SHA-256으로 판별한다. 파일 수·크기·수정 시간이 같아도 내용이 다르면 재분석한다. 일부만 분석된 `partial` 작품과 `failed` 작품은 다음 실행에서 재시도한다. 일부 정상 이미지가 있는 `partial` 작품은 표시를 남긴 채 인덱스에 포함한다.
- 수집기의 `.part` 파일은 읽지 않는다. 분석 도중 입력이 달라진 작품은 군집 대상에서 제외하고 `index.json.excluded`에 기록한다. 수집이 끝난 뒤 전체 분석을 다시 실행하면 반영한다. 실행 후 새로 생긴 작품은 다음 실행에서 발견한다.
- 새 특징을 저장하기 전 기존 인덱스를 무효화한다. `--skip-clustering`이나 오류·중단 후 `similar`에서 오래된 결과를 반환하지 않으며 `cluster` 실행을 안내한다.
- 같은 결과 폴더를 사용하는 두 분석 프로세스는 `.analysis.lock`으로 차단한다. 강제 종료 뒤 잠금이 남으면 **동일 출력 폴더를 쓰는 분석 프로세스가 없는지 확인한 다음** 해당 `.analysis.lock` 파일을 삭제한다. 수집기의 `.crawl.lock`과는 별개다.
- 이전 설정의 크롭과 더 이상 입력에 없는 작품 결과는 자동 삭제하지 않는다. 현재 인덱스는 현재 선택된 입력 작품만 포함한다. 디스크 용량 관리를 위해 오래된 결과 폴더를 보관·삭제할 수 있다.

| 종료 코드 | 의미 |
| --- | --- |
| 0 | 성공 |
| 1 | 설정·모델·설치·실행 오류 |
| 2 | 완료했지만 일부 이미지/작품 오류 또는 인덱스 제외 항목이 있음 |
| 130 | 사용자 중단 |

## 8. 추천 백엔드 연동

분석 결과(작품 JSON 약 1.7GB)는 서버에 그대로 올리지 않는다. 카탈로그 작품별로 압축한 그림체 벡터만 `Backend/data/art-style.json`(약 7MB)으로 내보낸다. 카탈로그 `id`와 작화 결과의 `work_id`가 같은 값(`naver_641253`, `kakao_2320` 등)이라 그대로 연결된다.

```powershell
# 분석/cluster가 끝난 뒤 실행. 결과 폴더는 ART_OUTPUT_DIR 또는 --results
& "$env:ART_ENGINE_HOME\venv\Scripts\python.exe" .\scripts\export-art-style.py --results C:\webtoon-analysis
```

- 엔진이 군집화에 쓰는 것과 같은 DINOv2+WD-14 결합 벡터(8,490차원)를 **평균을 빼지 않는 truncated SVD**로 128차원까지 줄인다. 평균을 빼는 PCA는 엔진의 cosine 이웃 순위를 크게 바꾸므로 사용하지 않는다. 출력에 원래 공간 top-10 이웃 보존율(`top10_neighbour_recall`, 2026-11-08 기준 0.76)을 표시한다.
- 파일에는 보정값 `calibration.baseline`(무작위 작품 쌍 cosine 중앙값)과 `similarThreshold`(무작위 쌍 상위 1%)가 들어 있다.
- 백엔드 추천 워커는 시작할 때 이 파일을 읽는다. 최종 점수는 **`0.75 × 기존 텍스트 점수 + 0.25 × 그림체 점수`**다. 그림체 점수는 선택한 작품마다 `(cos − baseline) / (1 − baseline)`을 0~1로 자른 값의 평균이다. 선택 작품 중 하나와 cosine이 `similarThreshold` 이상이면 추천 이유에 "그림체가 비슷해요"를 넣는다.
- 그림체 데이터가 없는 작품(새로 수집했지만 아직 분석하지 않은 작품)은 기존 텍스트 점수를 그대로 쓴다. 파일이 없으면 텍스트 추천만 동작하고, 파일 형식이 잘못되면 오류를 로그에 남긴 뒤 텍스트 추천으로 동작한다.
- 새 작품을 분석했으면 `analyze` → `export-art-style.py` 순서로 다시 실행하고 백엔드를 재배포한다.
- 내보낸 작화 데이터는 공개 SEO 페이지에서도 사용한다. `npm --prefix Frontend run sync:art`로 공개 소개 작품의 빌드용 스냅샷을 갱신한 뒤 프론트엔드를 빌드·배포한다. 전체 저장소 빌드에서는 원본과 스냅샷이 다르면 갱신을 안내하고 중단한다.

텍스트 내부 상대 비율(장르 38, 태그 30, 줄거리 17, 제목 10, 작가 5)은 유지한다. 작화와 모든 텍스트 항목에 데이터가 있을 때 전체 점수 비중은 다음과 같다. 누락된 텍스트 항목은 제외하고 나머지 텍스트 항목에 75%를 재분배하며, 작화 비중은 25%로 유지한다.

| 항목 | 전체 점수 비중 |
| --- | --- |
| 장르 | 28.5% |
| 태그·취향 특징 | 22.5% |
| 줄거리 | 12.75% |
| 제목 | 7.5% |
| 작가 | 3.75% |
| 작화 | 25% |

## 개발 검증

```powershell
.\.venv-art\Scripts\python.exe -m unittest discover -s .\tools\art-style-engine\tests -v
.\.venv-art\Scripts\python.exe -m pip check
```

자동 테스트는 임시 입력 폴더를 사용한다. 재개·변경 감지·손상 이미지·중복 이미지·배치 OOM 처리·원본 대체·실제 UMAP/HDBSCAN을 확인한다. 테스트의 가짜 추론기는 제어 흐름 검증에만 사용하며 실제 `analyze`에는 테스트용 모델이나 임의 벡터를 사용하지 않는다.

2026-11-07 검증에서 자동 테스트 17개, 실제 3작품·7이미지·22영역 CPU 추론, JSON 스키마, 재개, 네트워크 차단 상태 추론을 확인했다. Windows Python 3.11용 바이너리 패키지 조합도 확인했다. **현재 검증 환경은 macOS CPU이며 Windows에서의 실제 CUDA 실행·속도·VRAM 사용량은 미검증**이다. 자세한 범위는 [검증 기록](art-style-engine-verification-2026-11-07.json)에 남겼다.

모델·구현 기준: [DINOv2 공식 모델](https://huggingface.co/facebook/dinov2-small), [WD SwinV2 Tagger v3](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3), [WD timm 전처리 예제](https://github.com/neggles/wdv3-timm), [YOLOv8-face 원본](https://github.com/lindevs/yolov8-face), [Ultralytics YOLOv8](https://docs.ultralytics.com/models/yolov8/), [UMAP 군집화 문서](https://umap-learn.readthedocs.io/en/latest/clustering.html), [HDBSCAN 문서](https://hdbscan.readthedocs.io/en/latest/), [PyTorch CUDA 휠 설치](https://pytorch.org/get-started/previous-versions/). DINO/WD 가중치는 코드에 지정한 Hugging Face 커밋으로 고정하고, 준비한 모든 모델 파일의 SHA-256을 확인한다.
