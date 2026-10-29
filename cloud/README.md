# 기기 동기화 서버 (Cloudflare Worker + D1)

탭과 휴대폰의 연습 기록, 악보, 내 표시, 복습함, 레슨 노트, 세브치크 팩을 맞춰 주는 아주 작은 서버예요. 녹음은 동기화하지 않아요.

- **비용:** 무료 플랜 안에서 돌아가요. D1만 쓰기 때문에 결제 수단을 등록할 필요가 없어요.
- **사용량 (한 사람 기준):** 무료 한도와 견주면 이 정도예요.
  - 요청: 하루 수백 건 (한도는 하루 10만 건)
  - 저장: 수십 MB (한도는 5GB)
- **보안:** 동기화 열쇠(긴 비밀 글자)를 아는 기기만 읽고 쓸 수 있어요.
  - 열쇠는 각 기기의 앱 안에만 저장돼요.
  - 악보는 이 서버(내 계정)에만 올라가고, 저장소(GitHub)에는 들어가지 않아요.

## 처음 한 번 설치 (PC, PowerShell)

PC에 Node.js가 있어야 해요. `node -v`를 쳤을 때 안 나오면 https://nodejs.org 에서 LTS 버전을 설치하세요.

1. **Cloudflare 무료 가입:** https://dash.cloudflare.com/sign-up

2. **이 폴더에서 준비하고 로그인:**
   ```powershell
   cd "개발 프로젝트\violin\violin-practice\cloud"
   npm install
   npx wrangler login
   ```
   브라우저가 열리면 "Allow"를 누르세요.

3. **데이터베이스 만들기:**
   ```powershell
   npx wrangler d1 create violin-sync
   ```
   - 출력된 `database_id = "…"` 값을 `wrangler.toml`의 `database_id` 자리에 붙여 넣으세요.
   - "add it on your behalf?" 하고 물으면 **n**을 누르세요. 이미 적어 둔 칸이 있어서 직접 붙여 넣는 편이 안전해요.

4. **서버 올리기:**
   ```powershell
   npx wrangler deploy
   ```
   - 처음이면 workers.dev 하위 주소 이름을 정하라고 물어요. 아무 이름이나 정하면 돼요.
   - 끝나면 `https://violin-sync.<이름>.workers.dev` 주소가 나와요. 이 주소를 적어 두세요.

5. **동기화 열쇠 만들어 넣기:**
   ```powershell
   node new-key.mjs
   npx wrangler secret put SYNC_KEY
   ```
   첫 줄이 출력한 32글자를 복사해 두고, 두 번째 명령이 물으면 붙여 넣으세요.

6. **확인:** 아래 명령에서 `{"ok":true,"seq":0}`이 나오면 성공이에요.
   ```powershell
   curl.exe -H "Authorization: Bearer <열쇠>" https://violin-sync.<이름>.workers.dev/ping
   ```

7. **기기 연결 링크 만들기:**
   ```powershell
   node make-link.mjs https://violin-sync.<이름>.workers.dev <열쇠>
   ```
   나온 링크를 카카오톡 "나와의 채팅" 등으로 나에게 보내세요.
   - **먼저 탭(주로 쓰는 기기)**에서 링크를 열면 설정이 열리고 칸이 채워져 있어요. **동기화 켜기**를 누르세요.
   - 그다음 휴대폰에서 같은 링크를 열고 똑같이 켜세요.
   - 링크 대신 설정 → 기기 동기화에 주소와 열쇠를 직접 넣어도 돼요.

## 어떻게 맞추나요

- **자동 동기화:** 이럴 때 알아서 맞춰요.
  - 앱을 열 때와 다시 볼 때
  - 무언가 바꾼 뒤 5초
  - 앱이 열려 있는 동안 2분마다
  - 설정의 **지금 동기화**를 눌렀을 때
- **충돌:** 같은 항목을 두 기기에서 고치면 나중에 고친 쪽이 이겨요.
- **처음 켤 때:** 이미 서버에 있는 것이 이기고, 이 기기에만 있던 기록은 합쳐져요.
  - 그래서 **주로 쓰는 기기를 먼저** 켜세요.
- **기기마다 다른 설정:** 이어폰 지연 보정, 마이크 감도는 기기마다 따로 둬요.
- **녹음:** 동기화하지 않아요. 다른 기기에서 그 채점 기록을 열면 "녹음이 이 기기에 없어요"라고 나와요.
- **여러 항목을 한 줄에 담는 것:** 마디 템포 사다리, 연습곡 진도, 악보 폴더 목록이 그래요. 두 기기 것을 항목별로 합쳐요. 그래서 한쪽에서 지운 항목이 다시 살아날 수는 있어요.
- **같은 세브치크 변형을 두 기기에서 따로 처음 열었을 때:** 한 악보로 합쳐져요. 채점 기록·복습·내 표시도 같이 옮겨져요.
- **동기화 끄기:** 이 기기의 기록은 그대로 남아요. 다시 켜면 서로 맞추는데, 같은 항목은 나중에 고친 쪽이 이겨요. 끈 동안 지운 것도 다시 켤 때 알려요.
- **동기화 중에 백업에서 되돌리기:** 되돌린 내용이 다른 기기로 퍼져요. 다만 다른 기기에서 새로 생긴 기록은 지우지 않고 합쳐요.

## 관리

- **사용량 보기:** Cloudflare 대시보드 → Workers & Pages / D1에서 봐요.
- **열쇠 바꾸기:** `npx wrangler secret put SYNC_KEY`로 새 열쇠를 넣으세요. 그다음 각 기기에서 동기화를 끄고, 새 열쇠로 다시 켜면 돼요.
- **서버를 처음부터 다시:**
  ```powershell
  npx wrangler d1 execute violin-sync --remote --command "DELETE FROM rec; DELETE FROM blob;"
  ```
  - 기기에 있는 기록은 지워지지 않아요.
  - 각 기기에서 동기화를 끄고 다시 켜면 다시 올라가요.
- **서버 코드를 고쳤을 때:** `npx wrangler deploy`만 다시 하면 돼요.

## 개발

- `src/index.ts`: 서버 전체 (API 설명은 맨 위에 있어요)
- **로컬에서 돌려 보기:** `.dev.vars`에 `SYNC_KEY="아무거나16글자이상"`을 넣고 `npx wrangler dev`를 실행해요.
- **테스트:** 앱 쪽 `tests/syncServer.test.ts`(서버)와 `tests/sync.test.ts`(두 기기)에 있어요.
- **끝에서 끝까지 확인:** `tests/local/sync-e2e.mjs`는 진짜 Worker(로컬)와 빌드한 앱 두 개로 확인해요.
