# 웹툰 크롤러 콘솔

Windows 로컬 UI: **크롤 → SQLite → JSON 통합 → Git push → Railway/Vercel 배포**

## 준비

- Node.js 22+
- `Backend` · `KOREA_WEBTOON_API`에 각각 `npm ci`
- **Git** 저장소 + `origin` remote (배포 3단계)
- **Railway CLI** (`npm i -g @railway/cli`) + `Backend`에서 `railway login` · `railway link` (Railway 배포 시)
- (선택) **Vercel CLI** — `deploy.vercel.enabled: true`일 때

## 설정

1. `config.example.json` → `config.json`
2. `adminSecret` (32자+, 크롤러와 동일)
3. **`deploy`** 블록 — Git 브랜치·Railway/Vercel on/off

```json
"deploy": {
  "enabled": true,
  "git": { "enabled": true, "branch": "main" },
  "railway": { "enabled": true, "serviceDir": "Backend" },
  "vercel": { "enabled": false }
}
```

4. (선택) `projectRoot` — 비우면 저장소 루트 자동

## 실행

```powershell
# 터미널 A
cd tools\crawler-console
.\start-crawler.ps1

# 터미널 B
.\start-console.ps1
```

**http://127.0.0.1:3780/**

| 단계 | 버튼 |
|------|------|
| 1 | 네이버 / 카카오 크롤 |
| 2 | 통합 실행 |
| 3 | 배포 실행 |

## 3단계 배포 동작

1. **Git** — 카탈로그 경로만 `add` → `commit` → `push origin <branch>`
2. **Railway** — `Backend`에서 `railway up --detach`  
   - Windows 한글 경로 이슈 시 `useTempCopyOnWindows: true` (`.railway` 링크 폴더도 함께 복사됨)
3. **Vercel** — (옵션) `Frontend`에서 `npx vercel --prod --yes`

GitHub에 Backend만 연결된 경우 **push만으로 Railway가 자동 빌드**되면 `railway.enabled: false`로 CLI 배포를 끌 수 있습니다.

## 사전 점검 (Windows)

```powershell
git -C "프로젝트루트" status
cd Backend
railway whoami
railway status
```

## 문제 해결

| 증상 | 조치 |
|------|------|
| 커밋할 변경 없음 | 2단계 통합 먼저 실행 |
| `git push` 실패 | remote·SSH/HTTPS 인증·브랜치 이름 확인 |
| `railway` not found | CLI 설치·PATH |
| Railway link 없음 | `cd Backend` → `railway link` |
| 배포 비활성 | `deploy.enabled: true` |

## 보안

- `config.json`은 gitignore — 비밀키·토큰 커밋 금지
- Railway/Vercel은 OS에 저장된 CLI 로그인 세션 사용
