> 2026-10-16 보안 보완: 최신 실행·환경 변수·배포 및 복구 절차는 프로젝트의 `docs/security-audit-2026-10-16/deployment.md`를 우선 참고하세요. 아래 과거 안내의 무인증 크롤링 트리거는 더 이상 제공하지 않습니다. 크롤러 설치는 npm ci를 사용합니다.

# Railway 배포 (GitHub 계정)

이전에 Cursor 환경의 CLI가 **naver 메일 Railway 계정**(`rlfgustn0186@naver.com`)으로 배포한 서비스는, **GitHub로 로그인하는 Railway 대시보드에는 보이지 않습니다.**

Supabase 데이터(`webtoons` 30건)는 그대로 두고, **본인 GitHub Railway 워크스페이스**에 API만 다시 올리면 됩니다.

## 1. CLI를 GitHub 계정으로 전환

```bash
railway logout
railway login
```

브라우저에서 **GitHub**로 로그인합니다.

확인:

```bash
railway whoami
```

표시되는 사용자/이메일이 GitHub 연동 계정이어야 합니다.

## 2. 새 프로젝트·서비스 (권장)

```bash
cd Backend

# 새 프로젝트 생성 (대화형) 또는 대시보드에서 프로젝트 만든 뒤:
railway link

# 빈 서비스가 없으면 대시보드에서 Empty Service → 이름 예: webtoon-api
railway service link webtoon-api
```

## 3. 환경 변수 (Supabase는 기존 프로젝트 유지)

[Railway Variables](https://railway.com) 또는 CLI:

```bash
railway variables set \
  SUPABASE_URL="https://xcramulipbsvujoaviol.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<Supabase 대시보드 → Settings → API → service_role>" \
  CORS_ORIGIN="http://localhost:5173,http://127.0.0.1:5173" \
  NODE_ENV=production
```

`service_role` 키는 **저장소에 커밋하지 마세요.**

Vercel 도메인이 있으면 `CORS_ORIGIN`에 `https://your-app.vercel.app` 추가합니다.

## 4. 배포

Google Drive 한글 경로에서 빌드가 깨질 수 있어 **복사 후 배포**를 권장합니다.

```bash
rm -rf /tmp/webtoon-backend-deploy
cp -R "/path/to/웹툰추천/Backend" /tmp/webtoon-backend-deploy
cd /tmp/webtoon-backend-deploy
npm install
railway link    # GitHub 워크스페이스의 프로젝트·webtoon-api 선택
railway up
```

배포 후:

```bash
railway domain
curl "$(railway domain --json 2>/dev/null || echo https://YOUR_URL)/health"
```

## 5. 프론트 연결

`Frontend/.env.local`:

```env
VITE_API_URL=https://<새 Railway 도메인>
```

## 6. 이전(naver) 배포 정리 (선택)

naver Railway 계정에 접근 가능하면 `precious-encouragement` → `webtoon-api` 서비스를 삭제해 중복 과금을 막을 수 있습니다. GitHub 계정만 쓰면 **무시해도 됩니다** (본인 대시보드에 없음).

## Supabase

GitHub Railway로 옮겨도 **Supabase 프로젝트 ref는 동일** (`xcramulipbsvujoaviol`)하면 DB 재시드 없이 API만 바꿔 끼면 됩니다.
