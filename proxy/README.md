# SlideLab AI 중계 서버 (Cloudflare Worker)

SlideLab은 GitHub Pages에 올라가는 **공개 정적 사이트**라서, 앱 파일에 OpenAI API 키를 넣으면 누구나 꺼내 쓸 수 있습니다.
그래서 키는 이 작은 중계 서버(Cloudflare Workers, 무료 요금제로 충분)에만 두고, 앱은 중계 서버 주소만 압니다.

```
브라우저(SlideLab) ──접근 코드──▶ 중계 서버(Worker, OpenAI 키 보관) ──▶ api.openai.com
```

중계 서버가 하는 일
- `POST /v1/chat/completions`, `POST /v1/images/generations` **두 경로만** OpenAI로 전달합니다. 다른 경로·다른 사이트로는 보내지 않습니다.
- 허용한 사이트(기본값 `https://<GitHub 사용자>.github.io`)에서 온 요청만 받습니다.
- **접근 코드**가 맞아야 전달합니다. 공개 사이트라 누구나 접속할 수 있으므로 접근 코드가 실제 잠금장치입니다.
- (선택) 쓸 수 있는 모델을 제한합니다.
- `GET /health`로 키가 설정됐는지만 알려 줍니다. 키 값은 절대 응답에 담지 않습니다.

## 설치 (한 번만)

### 1. Cloudflare 준비
1. https://dash.cloudflare.com 에 가입합니다 (무료).
2. **Workers & Pages**를 한 번 열어 `workers.dev` 하위 도메인을 정합니다 (처음 한 번 묻습니다).
3. **계정 ID**를 복사합니다 (Workers & Pages 개요 화면 오른쪽, 또는 대시보드 주소의 긴 영문·숫자).
4. **API 토큰**을 만듭니다: 오른쪽 위 프로필 → My Profile → API Tokens → Create Token → 템플릿 **Edit Cloudflare Workers** → 계정 선택 → 만들기 → 토큰을 복사합니다.

### 2. OpenAI 키
1. https://platform.openai.com 의 API keys에서 키를 만듭니다.
2. **Billing → Limits에서 월 사용 한도**를 정해 두세요. 접근 코드가 새더라도 요금이 한도를 넘지 않습니다.

### 3. GitHub에 입력 (말씀하신 "GitHub에서 기입")
저장소 **Settings → Secrets and variables → Actions**에서:

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 1-4의 토큰 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 1-3의 계정 ID |
| Secret | `OPENAI_API_KEY` | 2의 OpenAI 키 |
| Secret | `AI_ACCESS_CODE` | 사용자에게 알려 줄 접근 코드 (길고 추측하기 어렵게. 정말 필요 없으면 `none`) |
| Variable (선택) | `AI_ALLOWED_MODELS` | 예: `gpt-5,gpt-5-mini,gpt-image-1` (비우면 제한 없음) |
| Variable (선택) | `AI_ALLOWED_ORIGINS` | 기본값 `https://<사용자>.github.io`. 직접 도메인을 쓰면 그 주소 |

Secrets 값은 GitHub에서도 다시 볼 수 없고, 워크플로가 Cloudflare Worker의 비밀 값으로만 올립니다.

### 4. 중계 서버 배포
1. 저장소 **Actions → Deploy AI proxy (Cloudflare Worker) → Run workflow**를 누릅니다 (`proxy/`를 고쳐 `main`에 푸시해도 자동 실행).
2. 로그 끝에 나오는 주소를 복사합니다: `https://slidelab-ai-proxy.<하위 도메인>.workers.dev`
3. 브라우저에서 `<주소>/health`를 열어 `{"ok":true,"keyConfigured":true,"accessCodeRequired":true}`인지 확인합니다.

### 5. 앱에 중계 서버 주소 알려 주기
1. 같은 화면의 **Variables** 탭에 `AI_PROXY_URL` = 4-2의 주소를 넣습니다. 주소는 비밀 값이 아닙니다.
   (선택) `AI_PROXY_MODEL` = 기본으로 쓸 GPT 모델 이름 (예: `gpt-5-mini`)
2. **Actions → Deploy to GitHub Pages → Run workflow**로 사이트를 다시 배포합니다.
3. 사이트에서 홈 탭 › **AI 도우미** › ⚙ 설정을 엽니다. "GPT — 사이트 중계 서버"가 기본으로 선택되어 있으니 **접근 코드**만 입력하고 **연결 테스트**를 누릅니다.

## 운영 팁
- **접근 코드 바꾸기**: Secret `AI_ACCESS_CODE`를 바꾸고 "Deploy AI proxy"를 다시 실행합니다.
- **OpenAI 키 바꾸기**: Secret `OPENAI_API_KEY`를 바꾸고 다시 실행합니다.
- 사이트 주소 확인(Origin)은 브라우저가 아닌 프로그램이 흉내 낼 수 있으므로, 실제 보호는 **접근 코드 + OpenAI 사용 한도**입니다.
  더 엄격하게 하려면 Cloudflare 대시보드의 **Security → WAF → Rate limiting rules**로 IP당 요청 수를 제한하세요.
- 로컬 시험: `.dev.vars.example`을 `.dev.vars`로 복사해 값을 넣고 `npx wrangler dev` (`.dev.vars`는 커밋하지 마세요).
