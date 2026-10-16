> 2026-10-16 보안 보완: 최신 실행·환경 변수·배포 및 복구 절차는 프로젝트의 `docs/security-audit-2026-10-16/deployment.md`를 우선 참고하세요. 아래 과거 안내의 무인증 크롤링 트리거는 더 이상 제공하지 않습니다. 크롤러 설치는 npm ci를 사용합니다.

# Vercel 배포 (Frontend)

퀴즈 앱은 현재 `src/data/webtoons.json` 로컬 샘플을 사용합니다. API 연동 시 `VITE_API_URL`을 설정합니다.

## 방법 A — Vercel 대시보드 (GitHub 연결, 권장)

1. [vercel.com](https://vercel.com) → **Add New… → Project**
2. GitHub 저장소 **`GilHyeonSoo/webtoon-recommend-frontend`** Import
3. **Root Directory** → `.` (저장소 루트 — Frontend만 포함)
4. Framework Preset: **Vite** (자동 감지)
5. **Environment Variables** (Production):

   | Name | Value |
   |------|--------|
   | `VITE_API_URL` | `https://webtoon-api-production-5e28.up.railway.app` |

6. **Deploy**

배포 URL 예: `https://웹툰추천-xxx.vercel.app`

Railway API는 `*.vercel.app` 출처를 CORS 허용하도록 Backend에 설정되어 있습니다. 프로덕션 도메인을 **Custom Domain**으로 쓰면 Railway `CORS_ORIGIN`에 그 URL을 추가하고 Backend를 재배포하세요.

## 방법 B — Vercel CLI

```bash
cd Frontend
npx vercel login
npx vercel link          # 프로젝트 생성/연결
npx vercel env add VITE_API_URL production
# 값: https://webtoon-api-production-5e28.up.railway.app
npx vercel --prod
```

## 배포 후 확인

- 퀴즈를 끝까지 진행해 추천 3작품이 나오는지 확인
- (API 사용 시) 브라우저 Network에서 `webtoon-api-production-5e28.up.railway.app` 호출 성공 여부

## Backend CORS 재배포

`Backend/src/index.ts`에서 Vercel 미리보기 도메인을 허용했습니다. 변경 후:

```bash
cp -R Backend /tmp/webtoon-backend-deploy
cd /tmp/webtoon-backend-deploy
railway link   # webtoon-api
railway up
```
