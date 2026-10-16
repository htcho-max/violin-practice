# 바이올린 연습 도우미 (1단계)

스즈키 4권을 연습하는 성인 취미 연주자를 위한 연습 앱입니다. 기획서: https://claude.ai/code/artifact/d0736731-3522-420c-a656-e0f1ecd41468

## 1단계 기능
- **오늘**: 루틴(튜닝 → 음계·드론 → 포지션 이동 → 곡 구간 → 복습) 타이머, 항목별 시간, 메모 저장. 다른 탭에서도 계속 돌아감
- **튜너**: 자동(음이름+센트) / 현 선택 모드, G·D·A·E 기준음, A=438~445Hz
- **메트로놈**: 30~250 BPM, 탭 템포, 2/4·3/4·4/4·6/8, 8분·셋잇단·16분 분할, 첫 박 강조, 우드블록/전자음. 스페이스바로 시작·정지
- **음정(드론)**: G장조·D장조·A단조·D단조 프리셋, 4권 곡으로 고르기, 5도 추가, 드론 기준 순정률 / 평균율 센트 표시
- **기록**: 달력, 연속 일수, 이번 주 합계, 날짜별 세션과 메모. 설정에서 JSON 내보내기

데이터는 이 기기 브라우저(IndexedDB)에만 저장됩니다.

## 실행 (Windows)
```
npm.cmd install
npm.cmd run dev        # PC에서 http://localhost:5173
npm.cmd run phone      # 같은 와이파이의 휴대폰에서 https://<PC IP>:5173
```
휴대폰은 마이크 때문에 HTTPS가 필요해서 `phone` 모드는 임시 인증서를 씁니다. 처음 접속할 때 "안전하지 않음" 경고가 나오면 "고급 → 계속"을 누르세요. PC의 IP는 `ipconfig`의 IPv4 주소입니다. Windows 방화벽이 물어보면 허용하세요.

## 휴대폰에서 쓰기 (GitHub Pages 배포)
`main` 브랜치에 올리면 `.github/workflows/deploy.yml`이 테스트 → 빌드 → 배포를 자동으로 합니다 (1~2분).
앱 주소: `https://<GitHub 아이디>.github.io/violin-practice/`

처음 한 번만 (명령 프롬프트에서):
```
cd "%USERPROFILE%\OneDrive - 에이비스\문서\개인\개발 프로젝트\violin\violin-practice"
git init -b main
git add .
git commit -m "바이올린 연습 도우미 1단계"
git remote add origin https://github.com/<GitHub 아이디>/violin-practice.git
git push -u origin main
```
그다음 GitHub 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 바꾸고, **Actions** 탭에서 실패한 첫 실행을 **Re-run**하세요.
휴대폰에서 주소를 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있고, 한 번 연 뒤에는 인터넷 없이도 열립니다.
새 버전은 앱을 다시 열 때 자동으로 받고 "새 버전으로 업데이트됐어요" 알림이 뜹니다. 설정 화면 아래에서 버전 확인, 업데이트 확인을 할 수 있어요.

## 검증
```
npm.cmd test           # 음높이 감지(G3~E6, 3종 음색, ±3센트), 메트로놈 10분 오차 1ms 미만 등 24개
npm.cmd run smoke      # 빌드본 + 가짜 마이크(445Hz)로 전체 흐름 11개 확인 (Playwright Chromium 필요)
```

## 구조
- `src/audio`: 음높이 감지(pitchy MPM, clarity 0.9, 중앙값 5프레임, 메트로놈 클릭 구간 제외), 메트로놈(Worker 타이머 + lookahead 100ms), 드론, 기준음
- `src/state`: 설정(IndexedDB), 연습 세션(localStorage에 진행 상태 보관), 화면 꺼짐 방지
- `src/pages`: 오늘 · 튜너 · 메트로놈 · 음정 · 기록

## 다음 (2단계)
음정 그래프, 템포 트레이너, 곡별 진도·복습 순환, 녹음과 비교
