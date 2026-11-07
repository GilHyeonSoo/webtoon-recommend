# 작화 분석 엔진

Windows 설정·실행·JSON 필드·검증 방법은 [작화 분석 엔진 안내](../../docs/ART-STYLE-ENGINE.ko.md)를 참고하세요.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-art-engine-windows.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 scan
powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --device cuda
```

기본 입력: 프로젝트 루트 `이미지/플랫폼/작품ID/파일`

기본 결과: 프로젝트 루트 `작화분석결과/`

기본 모델 캐시: 프로젝트 루트 `.art-models/`
