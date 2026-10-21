// 빌드본 + 가짜 마이크로 전체 흐름 확인
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const server = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const URL = 'http://localhost:4319/';
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) process.exitCode = 1; };
const num = (s) => Number(String(s).replace(/[^\d.+-]/g, ''));

async function launch(wav) {
  const browser = await chromium.launch({
    timeout: 20000,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve('scripts', wav)}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  return { browser, page, errors };
}
const seen = (loc) => loc.first().waitFor({ timeout: 4000 }).then(() => true, () => false);
const tab = (page, name) => page.locator('.tabbar').getByRole('button', { name }).click();

try {
  // ── 1. 기본 흐름 (A4 +20센트) ──
  {
    const { browser, page, errors } = await launch('a445.wav');
    await tab(page, '튜너');
    await page.getByRole('button', { name: '마이크 켜기' }).click();
    await page.waitForTimeout(2500);
    ok((await page.getByTestId('note').textContent()) === 'A4', '튜너 음이름 A4');
    const c = num(await page.getByTestId('cents').textContent());
    ok(Math.abs(c - 20) <= 3, `튜너 센트 ${c} (기대 +20)`);
    await page.screenshot({ path: 'scripts/shot-tuner.png' });

    await tab(page, '메트로놈');
    await page.getByRole('button', { name: '+5' }).click();
    ok((await page.getByTestId('bpm').textContent()) === '85', 'BPM 80 → 85');
    await page.getByTestId('metro-toggle').click();
    await page.waitForTimeout(1200);
    ok((await page.locator('.dot.on').count()) === 1, '박 표시');
    // 템포 트레이너 (성공 3번 → +4)
    await page.getByText('템포 트레이너', { exact: true }).click();
    await page.getByTestId('ladder-start').click();
    for (let i = 0; i < 3; i++) await page.getByTestId('ladder-ok').click();
    ok((await page.getByTestId('bpm').textContent()) === '89', `트레이너 성공 3번 → BPM ${await page.getByTestId('bpm').textContent()}`);
    await page.screenshot({ path: 'scripts/shot-trainer.png', fullPage: true });
    await page.getByRole('button', { name: '트레이너 끝내기' }).click();
    ok(/최고 ♩89/.test(await page.getByTestId('ladder-message').textContent()), '트레이너 결과 메시지');
    // 시작·목표 숫자 직접 입력 (다 지우고 60, 100)
    await page.getByTestId('ladder-from').fill('60'); await page.getByTestId('ladder-from').blur();
    await page.getByTestId('ladder-to').fill('100'); await page.getByTestId('ladder-to').blur();
    await page.waitForTimeout(200);
    ok((await page.getByTestId('ladder-from').inputValue()) === '60' && (await page.getByTestId('ladder-to').inputValue()) === '100', '트레이너 시작 60 · 목표 100 입력');
    await page.getByTestId('ladder-start').click();
    await page.waitForTimeout(300);
    ok((await page.getByTestId('bpm').textContent()) === '60', `트레이너 시작 템포 60 (${await page.getByTestId('bpm').textContent()})`);
    await page.getByRole('button', { name: '트레이너 끝내기' }).click();
    await page.getByTestId('metro-toggle').click();

    // 곡 목록 + 1~3권 불러오기 → 오늘의 복습 곡
    await tab(page, '기록');
    await page.getByRole('button', { name: '곡', exact: true }).click();
    ok(await seen(page.getByRole('button', { name: '전체 7' })), '4권 곡 7개 기본 등록');
    await page.getByTestId('seed-old').click();
    await page.waitForTimeout(300);
    ok(await seen(page.getByRole('button', { name: '전체 43' })), '1~3권 불러오기 → 43곡');
    await page.screenshot({ path: 'scripts/shot-pieces.png' });
    await tab(page, '오늘');
    await seen(page.getByTestId('review-list'));
    ok((await page.getByTestId('review-list').locator('li').count()) === 2, '오늘의 복습 곡 2개');

    // 세션 + 곡 선택
    await page.getByTestId('session-start').click();
    await page.waitForTimeout(1100);
    for (let i = 0; i < 3; i++) await page.getByTestId('session-next').click();
    ok((await page.getByTestId('session-item').textContent()) === '곡 구간 연습', '곡 구간 연습 항목');
    await page.locator('.session .chips .chip').first().click();
    await page.waitForTimeout(1100);
    await page.screenshot({ path: 'scripts/shot-session.png', fullPage: true });
    await page.getByTestId('session-finish').click();
    await page.getByPlaceholder(/메모/).fill('스모크 테스트');
    await page.getByTestId('session-save').click();
    await page.waitForTimeout(400);
    await tab(page, '기록');
    await page.locator('.log .segmented').getByRole('button', { name: '연습 기록' }).click();
    await page.screenshot({ path: 'scripts/shot-log.png', fullPage: true });
    ok((await page.getByText('스모크 테스트').count()) >= 1, `세션 메모 저장 (${await page.getByText('스모크 테스트').count()})`);
    ok(await page.getByText(/곡 구간 연습 · 자이츠/).isVisible(), '세션에 곡 이름 기록');

    // 녹음 2개 → 비교
    await page.locator('.log .segmented').first().getByRole('button', { name: '녹음' }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('rec-toggle').click();
      await page.waitForTimeout(2500);
      await page.getByTestId('rec-toggle').click();
      await page.waitForTimeout(700);
    }
    ok(await page.getByText('녹음 2개').isVisible(), '녹음 2개 저장');
    const boxes = page.getByRole('checkbox', { name: '비교에 넣기' });
    await boxes.nth(0).check(); await boxes.nth(1).check();
    ok(await page.getByTestId('compare').isVisible(), '두 녹음 비교 화면');
    const statText = await page.getByTestId('compare').textContent();
    ok(/평균 ±(19|20|21)센트/.test(statText), `녹음 음정 요약: ${statText.match(/평균 ±\d+센트/)?.[0]}`);
    const dur = await page.locator('audio').first().evaluate((a) => new Promise((r) => { if (a.readyState >= 1) r(a.duration); else a.onloadedmetadata = () => r(a.duration); setTimeout(() => r(a.duration), 3000); }));
    ok(dur > 1 || dur === Infinity, `녹음 재생 가능 (길이 ${dur})`);
    await page.screenshot({ path: 'scripts/shot-compare.png', fullPage: true });

    await page.reload();
    await tab(page, '메트로놈');
    ok((await page.getByTestId('bpm').textContent()) === '60', '새로고침 후 BPM 유지');
    // 백업 → 되돌리기
    await tab(page, '오늘');
    await page.getByRole('button', { name: '설정' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup').click()]);
    const fp = await dl.path();
    const fs = await import('node:fs');
    const bk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    ok(bk.version === 2 && bk.tables.sessions.length >= 1 && bk.tables.pieces.length >= 6, `백업 파일 (세션 ${bk.tables.sessions.length}, 곡 ${bk.tables.pieces.length})`);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('restore-file').setInputFiles(fp);
    ok(/되돌렸어요/.test(await page.getByTestId('data-msg').textContent({ timeout: 5000 }).catch(() => '')), '백업에서 되돌리기');
    await page.waitForTimeout(2500);
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2. 음계 + 포지션 이동 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '음정');
    await page.getByTestId('mic-toggle').click();
    await page.waitForTimeout(5000);
    const rows = await page.getByTestId('note-summary').locator('tbody tr').allTextContents();
    ok(rows.length >= 4, `음별 평균 오차 ${rows.length}음: ${rows.slice(0, 4).join(' / ')}`);
    // B4 는 두 번(+12, 0) → 평균 +6, C#5 는 -6
    ok(rows.some((r) => /^B4\+[5-7]2$/.test(r)) && rows.some((r) => /^C#5-[5-7]1$/.test(r)), `B4 평균 +6(2회), C#5 -6: ${rows.join(' / ')}`);
    await page.screenshot({ path: 'scripts/shot-graph.png', fullPage: true });
    await page.getByRole('button', { name: '도착 음정' }).click();
    const arr = await page.getByTestId('arrival-table').textContent();
    ok(/D5\+2\d/.test(arr) && /고쳐 잡음/.test(arr), '이동 뒤 D5 도착 +2x → 고쳐 잡음 표시');
    await page.screenshot({ path: 'scripts/shot-arrival.png', fullPage: true });
    // 따라 하기 (앱이 들려준 구절을 따라 켜기)
    await page.getByTestId('mode-echo').click();
    ok(await seen(page.getByTestId('echo-card')), '음정 탭에 따라 하기');
    ok(/G3 A3 B3/.test(await page.getByTestId('echo-card').textContent()), '기본: G장조 세 음 (G3 A3 B3)');
    await page.getByTestId('echo-key').selectOption('D');
    await page.getByTestId('echo-level-five').click();
    ok(/D4 E4 F♯4 G4 A4/.test(await page.getByTestId('echo-card').textContent()), 'D장조 다섯 음 (조 철자 F♯)');
    ok((await page.getByTestId('echo-len').textContent()) === '3', '처음 3음');
    await page.getByTestId('echo-new').click();
    await page.waitForFunction(() => /따라 켜요/.test(document.querySelector('[data-testid=echo-phase]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
    ok(/따라 켜요/.test(await page.getByTestId('echo-phase').textContent()), '구절을 들려준 뒤 듣기');
    await page.waitForTimeout(1500);
    await page.getByTestId('echo-stop').click({ timeout: 3000 }).catch(() => {});
    ok(await seen(page.getByTestId('echo-result')), `따라 하기 채점 (${(await page.getByTestId('echo-result').textContent().catch(() => '')).slice(0, 40)})`);
    ok(/운지/.test(await page.getByTestId('echo-result').textContent().catch(() => '')), '정답 운지 표시');
    ok(/맞음|정답/.test(await page.getByTestId('echo-phase').textContent()), `결과 문구 (${await page.getByTestId('echo-phase').textContent()})`);
    await page.screenshot({ path: 'scripts/shot-echo.png', fullPage: true });
    const nEcho = await page.evaluate(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
      const n = await new Promise((res) => { const g = dbx.transaction('echoRuns').objectStore('echoRuns').count(); g.onsuccess = () => res(g.result); });
      dbx.close();
      return n;
    });
    ok(nEcho === 1, `따라 하기 기록 저장 (${nEcho})`);
    await page.reload();
    await tab(page, '음정');
    await page.getByTestId('mode-echo').click();
    ok((await page.getByTestId('echo-key').inputValue()) === 'D' && (await page.getByTestId('echo-level-five').evaluate((el) => el.classList.contains('on'))), '조·난이도 기억');
    await tab(page, '기록');
    await page.locator('.log .segmented').getByRole('button', { name: '연습 기록' }).click();
    ok(/따라 하기 1문제/.test(await page.getByTestId('day-echo').textContent().catch(() => '')), '연습 기록 달력에 따라 하기');
    ok(/D장조 · 다섯 음/.test(await page.getByTestId('day-echo').textContent().catch(() => '')), '따라 하기 조·난이도');
    await page.getByTestId('log-insights').click();
    ok(await seen(page.getByTestId('trend-echoPct')), '분석: 따라 하기 주별 추이');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2b. 악보 불러오기 + 음표별 채점 (같은 phrases.wav: A4 B4+12 C#5-6 D5 | B4 D5) ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1500);
    const svgCount = await page.locator('[data-testid=osmd] svg').count();
    ok(svgCount >= 1, `악보 그리기 (svg ${svgCount})`);
    await page.getByTestId('to').fill('2');
    await page.waitForTimeout(800);
    await page.getByTestId('score-start').click();
    const lpSeen = new Set();
    const follow = new Set();
    for (let i = 0; i < 26; i++) {
      await page.waitForTimeout(200);
      for (const t of await page.getByTestId('live-pitch').allTextContents()) { const m = t.match(/^([A-G]#?\d)/); if (m) lpSeen.add(m[1]); }
      follow.add(await page.evaluate(() => { const g = document.querySelector('.now-note'); return g ? Math.round(g.getBoundingClientRect().left) : -1; }));
    }
    follow.delete(-1);
    ok(follow.size >= 3, `메트로놈 없이 연주 따라가기: 지금 음 표시가 ${follow.size}곳으로 옮겨 감`);
    ok(lpSeen.has('A4') && lpSeen.size >= 2, `연주 중 지금 내는 음 보기 (${[...lpSeen].join(' ')})`);
    await page.getByTestId('score-stop').click();
    await page.waitForTimeout(1200);
    const res = await page.getByTestId('score-result').textContent();
    const pct = Number(res.match(/(\d+)%/)?.[1]);
    ok(pct >= 80, `채점 결과 맞은 음 ${pct}% (${res.match(/맞은 음 \d+\/\d+/)?.[0]})`);
    ok(/B4\+1[0-4]/.test(res), 'B4 +12센트를 가장 벗어난 음으로 표시');
    const devs = await page.getByTestId('dev-tag').allTextContents();
    ok(devs.some((t) => /^▲1[0-4]$/.test(t)), `음표 옆 높낮이 표시 (${devs.join(' ')})`);
    await page.locator('[data-testid=osmd]').screenshot({ path: 'scripts/shot-dev.png' });
    ok(/녹음/.test(await page.getByTestId('run-saved').textContent().catch(() => '')), '채점하면 연습 기록과 녹음 저장');
    ok(/연습 기록 1번/.test(await page.getByTestId('run-history').textContent().catch(() => '')), '이 악보 연습 기록 표시');
    // 조 옮김: 반음 +2 → 첫 음 A4 가 B4 로 (악보 듣기 첫 음 표시로 확인)
    await page.getByTestId('transpose-toggle').click();
    await page.getByTestId('transpose-up').click(); await page.getByTestId('transpose-up').click();
    await page.waitForTimeout(1500);
    const keyTxt = await page.getByTestId('transpose-key').textContent().catch(() => '');
    ok(/장조|단조/.test(keyTxt) && /\+2/.test(await page.getByTestId('transpose-toggle').textContent()), `조 옮김 +2 (${keyTxt})`);
    const svgAfter = await page.locator('[data-testid=osmd] svg').count();
    ok(svgAfter >= 1, '조 옮긴 악보 다시 그리기');
    await page.getByTestId('transpose-reset').click();
    await page.waitForTimeout(800);
    // 전체 화면 켜고 끄기
    await page.getByTestId('fullscreen').first().click();
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !!document.fullscreenElement), '전체 화면 켜기');
    await page.getByTestId('fullscreen').first().click();
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.fullscreenElement), '전체 화면 끝내기');
    // 포지션 추천: 시험 악보(1포지션 음) → 시작에 I 표시, 손가락 번호
    await page.getByTestId('pos-toggle').click();
    await page.getByTestId('pos-fingers').check();
    await page.waitForTimeout(600);
    const ptags = await page.getByTestId('pos-tag').allTextContents();
    ok(ptags.length >= 2 && /^1st/.test(ptags[0]), `포지션 추천 표시 (${ptags.slice(0, 6).join(' ')})`);
    await page.getByTestId('pos-fingers').uncheck();
    await page.getByTestId('pos-toggle').click();
    // 계이름: 시험 악보(D장조) → 악보 가사 줄로 (고정 도 '라'·이동 도 '솔'·C D E 'A' 로 시작)
    const lyr = async () => (await page.locator('[data-testid=osmd] svg text').allTextContents()).map((t) => t.trim()).filter((t) => /^([도레미파솔라시]|[A-G])[♯♭𝄪𝄫]?$/.test(t));
    await page.getByTestId('solfa-toggle').click();
    await page.waitForTimeout(1500);
    const sf = await lyr();
    await page.getByTestId('solfa-movable').click(); await page.waitForTimeout(1500);
    const sm = await lyr();
    await page.getByTestId('solfa-letter').click(); await page.waitForTimeout(1500);
    const sl = await lyr();
    ok(sf.length >= 4 && sm.length === sf.length && sl.some((t) => /^[A-G]/.test(t)) && sf.join('') !== sm.join(''), `계이름 (고정 ${sf.slice(0, 4).join(' ')} / 이동 ${sm.slice(0, 4).join(' ')} / ${sl.slice(0, 4).join(' ')})`);
    await page.getByTestId('solfa-fixed').click();
    await page.getByTestId('solfa-toggle').click();
    await page.waitForTimeout(1200);
    // ♯·♭ 형광펜: D장조 시험 악보 → F♯·C♯ 칩, 칩 누르면 그 음 형광펜 빠짐
    await page.getByTestId('acc-toggle').click();
    await page.waitForTimeout(600);
    const chips = await page.getByTestId('acc-chip').allTextContents();
    const hl0 = await page.getByTestId('acc-hl').count();
    ok(chips.length >= 1 && chips.every((c) => /[♯♭]/.test(c)) && hl0 >= 1, `♯♭ 형광펜 (칩 ${chips.join(' ')}, 표시 ${hl0}개)`);
    await page.getByTestId('acc-chip').first().click();
    await page.waitForTimeout(400);
    const hl1 = await page.getByTestId('acc-hl').count();
    ok(hl1 < hl0, `익숙한 음 빼기 (${hl0} → ${hl1})`);
    await page.getByTestId('acc-chip').first().click();
    await page.getByTestId('acc-toggle').click();
    await page.getByTestId('score-result').locator('button').first().waitFor().catch(() => {});
    await page.getByTestId('run-history').locator('.rec-title').first().click();
    await page.waitForTimeout(300);
    ok(/맞은 음/.test(await page.getByTestId('run-insight').first().textContent().catch(() => '')), '연습 기록 누르면 분석 요약');
    await page.getByTestId('run-show').first().click();
    await page.waitForTimeout(800);
    ok(await seen(page.getByTestId('past-run')), '지난 기록을 악보에서 다시 보기');
    ok((await page.getByTestId('dev-tag').count()) > 0, '지난 기록에도 높낮이 표시');
    const colored = await page.locator('[data-testid=osmd] svg path[fill="#ca8a04"], [data-testid=osmd] svg path[fill="#15803d"], [data-testid=osmd] svg [fill="#ca8a04"], [data-testid=osmd] svg [fill="#15803d"]').count();
    ok(colored > 0, `음표 머리 색칠 (${colored})`);
    ok(await seen(page.getByTestId('rhythm-stats')), `박자 채점 표시 (${(await page.getByTestId('rhythm-stats').textContent().catch(() => '')).trim()})`);
    await page.getByTestId('view-rhythm').click();
    await page.waitForTimeout(800);
    ok(/늦게|일찍/.test(await page.getByTestId('rhythm-worst').textContent()), '박자로 보기: 일찍·늦게 음 목록');
    await page.screenshot({ path: 'scripts/shot-rhythm.png', fullPage: true });
    await page.getByTestId('view-pitch').click();
    await page.waitForTimeout(500);
    // 내 표시: 음표를 눌러 활·셈여림 붙이기 → 악보 위에 보이고, 다시 열어도 남음
    await page.getByTestId('mark-toggle').click();
    const head = await page.locator('[data-testid=osmd] .vf-notehead').nth(1).boundingBox();
    if (head) await page.mouse.click(head.x + head.width / 2, head.y + head.height / 2);
    ok(await seen(page.getByTestId('mark-sheet')), '표시 모드에서 음표를 누르면 표시 창');
    await page.getByTestId('mark-down').click();
    await page.getByTestId('mark-dyn-p').click();
    await page.getByTestId('mark-finger-3').click();
    await page.getByTestId('mark-pos-3').click();
    await page.waitForTimeout(400);
    await page.getByTestId('mark-close').click();
    await page.waitForTimeout(300);
    const labels = await page.getByTestId('mark-label').allTextContents();
    ok(labels.join(' ').includes('∏') && labels.join(' ').includes('p'), `악보 위 내 표시 (${labels.join(' / ')})`);
    ok(/3포지션/.test(labels.join(' ')) && /3/.test(labels.join(' ')), `내 표시 손가락·포지션 (${labels.join(' / ')})`);
    await page.getByTestId('mark-toggle').click();
    await page.reload();
    await page.waitForTimeout(800);
    if (!(await page.getByTestId('score-view').isVisible().catch(() => false))) {
      await tab(page, '악보');
      await page.getByText('스모크 테스트 음계').first().click();
    }
    await page.waitForTimeout(1800);
    const labels2 = await page.getByTestId('mark-label').allTextContents();
    ok(labels2.join(' ').includes('∏'), `다시 열어도 내 표시 유지 (${labels2.join(' / ')})`);
    await page.screenshot({ path: 'scripts/shot-marks.png', fullPage: true });
    // 반주 붙이기 (같은 악보를 반주로)
    await page.getByTestId('acc-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(800);
    ok(/반주 1파트/.test(await page.getByTestId('acc-card').textContent()), '반주 악보 붙이기');
    ok(await seen(page.getByTestId('acc-mute')), '반주 옵션 (내 파트 소리 끄기)');
    await page.screenshot({ path: 'scripts/shot-score.png', fullPage: true });
    // 악보 듣기: 재생 중 현재 음 강조, 끝나면 버튼 복귀
    await page.getByTestId('play-bpm').fill('200');
    await page.getByTestId('play-toggle').click();
    await page.waitForTimeout(2200);
    const lit = await page.locator('[data-testid=osmd] .now-note').count();
    ok(lit > 0, `재생 중 현재 음 강조 (${lit})`);
    await page.screenshot({ path: 'scripts/shot-play.png', fullPage: true });
    await page.waitForTimeout(2500);
    ok(/들어보기/.test(await page.getByTestId('play-toggle').textContent()), '재생 끝나면 버튼 복귀');
    // 재생 중 템포 변경: 끊기지 않고 이어서 재생
    await page.getByTestId('play-bpm').fill('40');
    await page.getByTestId('play-toggle').click();
    await page.waitForTimeout(7500); // 카운트인 4박(6초) + 첫 음
    const before = await page.evaluate(() => document.querySelector('.now-note')?.id);
    await page.getByTestId('play-bpm').fill('200');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => document.querySelector('.now-note')?.id);
    ok(!!before && !!after && before !== after, `재생 중 템포 변경 후 계속 진행 (${before} → ${after})`);
    // 떠 있는 조작: 멈춤 → 이어서
    if (await page.getByTestId('float-stop').isVisible().catch(() => false)) await page.getByTestId('float-stop').click();
    await page.getByTestId('play-bpm').fill('60');
    await page.getByTestId('play-bpm').blur();
    await page.getByTestId('play-toggle').click();
    await page.waitForTimeout(5000);
    ok(await seen(page.getByTestId('float-pause')), '재생 중 떠 있는 멈춤 버튼');
    await page.getByTestId('float-pause').click();
    const pausedId = await page.evaluate(() => document.querySelector('.now-note')?.id);
    await page.waitForTimeout(1200);
    const still = await page.evaluate(() => document.querySelector('.now-note')?.id);
    ok(!!pausedId && pausedId === still, `멈추면 그 음에서 정지 (${pausedId})`);
    await page.getByTestId('float-resume').click();
    await page.waitForTimeout(1600);
    const moved = await page.evaluate(() => document.querySelector('.now-note')?.id);
    ok(!!moved && moved !== pausedId, `이어서 재생 (${pausedId} → ${moved})`);
    await page.getByTestId('float-stop').click();
    ok(!(await page.getByTestId('float-ctl').isVisible().catch(() => false)), '정지하면 떠 있는 막대 사라짐');
    // 마디 입력: 다 지우고 새로 입력, 길이 칩
    await page.getByTestId('to').fill('');
    await page.getByTestId('to').fill('2');
    await page.getByTestId('to').blur();
    ok((await page.getByTestId('to').inputValue()) === '2', '끝 마디 지우고 다시 입력');
    await page.getByTestId('len-chips').getByRole('button', { name: '1마디' }).click();
    await page.waitForTimeout(400);
    ok((await page.getByTestId('to').inputValue()) === (await page.getByTestId('from').inputValue()), '1마디 칩 → 끝 = 시작');
    await page.getByRole('button', { name: '끝 마디 늘리기' }).click();
    await page.waitForTimeout(400);
    ok(Number(await page.getByTestId('to').inputValue()) === Number(await page.getByTestId('from').inputValue()) + 1, '끝 마디 + 버튼');
    // 휴대폰 뒤로 가기: 악보 → 목록
    await page.goBack();
    ok(await seen(page.getByTestId('open-exercises')), `뒤로 가기로 악보 목록 (${page.url()})`);
    await page.getByTestId('score-open').first().click();
    await page.waitForTimeout(1200);
    const order = await page.evaluate(() => { const a = document.querySelector('[data-testid=play-card]'), b = document.querySelector('.score-sheet'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); });
    ok(order, '메뉴가 악보 위에 있음');
    await page.screenshot({ path: 'scripts/shot-layout.png', fullPage: true });
    // 연습 기록 탭: 오늘 악보 연습 + 녹음 연동
    await page.getByTestId('play-toggle').click().catch(() => {});
    await tab(page, '기록');
    await page.locator('.log .segmented').getByRole('button', { name: '연습 기록' }).click();
    ok(await seen(page.getByTestId('day-runs')), '달력 오늘 칸에 악보 연습 기록');
    await page.getByTestId('day-runs').locator('.rec-title').first().click();
    ok(await seen(page.getByTestId('log-run-show')), '기록 화면에서 악보 분석 보기 버튼');
    ok(await seen(page.getByTestId('day-runs').locator('audio')), '연습 기록에서 녹음 재생');
    await page.screenshot({ path: 'scripts/shot-runs.png', fullPage: true });
    // 분석 → 주별 추이 (악보 채점)
    await page.getByTestId('log-insights').click();
    ok(await seen(page.getByTestId('trends')), '분석: 주별 추이');
    ok(/\d+%/.test(await page.getByTestId('trend-scorePct').textContent().catch(() => '')), `주별 악보 맞은 음 (${await page.getByTestId('trend-scorePct').textContent().catch(() => '')})`);
    ok(await seen(page.getByTestId('trend-scoreCents')), '주별 악보 음정 오차');
    ok((await page.getByTestId('trends').locator('svg.trend-bars').count()) >= 3, '주별 막대 그래프');
    await page.screenshot({ path: 'scripts/shot-insights.png', fullPage: true });
    await page.getByTestId('trends-table').click();
    ok((await page.getByTestId('trends').locator('tbody tr').count()) === 8, '추이 표 8주');
    ok(/\d+번/.test(await page.getByTestId('trends').locator('tbody tr').last().textContent()), '이번 주 채점 횟수');
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), '추이 표: 가로 넘침 없음');
    await page.locator('.log .segmented').first().getByRole('button', { name: '녹음' }).click();
    await page.getByTestId('rec-filter').getByRole('button', { name: '악보 연습' }).click();
    await page.locator('.rec-list .rec-title').first().click();
    ok(/악보 채점: 1~2마디/.test(await page.getByTestId('rec-run').textContent().catch(() => '')), '녹음 목록에 악보 채점 결과 연동');
    await page.locator('.log .segmented').first().getByRole('button', { name: '연습 기록' }).click();
    await page.getByTestId('day-runs').locator('.rec-title').first().click();
    await page.getByTestId('log-run-show').click();
    await page.waitForTimeout(2500);
    ok(await seen(page.getByTestId('past-run')), '기록 화면에서 눌러 악보로 가서 분석 보기');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }
  // ── 2d. 누른 음부터 듣기, 음 고치기 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1800);
    await page.getByTestId('to').fill('2');
    await page.waitForTimeout(1200);
    const headAt = async (i) => { const h = page.locator('[data-testid=osmd] .vf-notehead').nth(i); await h.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const b = await h.boundingBox(); return b ? [b.x + b.width / 2, b.y + b.height / 2] : [0, 0]; };
    // 2마디 첫 음을 눌러 그 마디부터 듣기
    let [x, y] = await headAt(4);
    await page.mouse.click(x, y);
    ok(await seen(page.getByTestId('here-bar')), '음표를 누르면 여기부터 듣기·채점 막대');
    await page.getByTestId('here-play').click();
    await page.waitForTimeout(1200);
    ok(Number(await page.getByTestId('from').inputValue()) === 2, '누른 마디부터 구간 시작');
    ok(await seen(page.getByTestId('float-pause')), '누른 마디부터 듣기 시작');
    await page.getByTestId('float-stop').click();
    await page.waitForTimeout(400);
    // 음 고치기: 보이는 둘째 음을 반음 올리기
    await page.getByTestId('edit-toggle').click();
    await page.waitForTimeout(600);
    [x, y] = await headAt(1);
    await page.mouse.click(x, y);
    ok(await seen(page.getByTestId('edit-sheet')), '음 고치기 창');
    const before = (await page.getByTestId('edit-note').textContent()).trim();
    await page.getByTestId('edit-up').click();
    await page.waitForTimeout(1500);
    const after = (await page.getByTestId('edit-note').textContent()).trim();
    ok(before !== after && after.length > before.length, `반음 올리기 (${before} → ${after})`);
    await page.getByTestId('edit-close').click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(800);
    if (!(await page.getByTestId('score-view').isVisible().catch(() => false))) {
      await tab(page, '악보');
      await page.getByText('스모크 테스트 음계').first().click();
    }
    await page.waitForTimeout(1800);
    await page.getByTestId('edit-toggle').click();
    await page.waitForTimeout(400);
    [x, y] = await headAt(1);
    await page.mouse.click(x, y);
    ok((await page.getByTestId('edit-note').textContent().catch(() => '')).trim() === after, '다시 열어도 고친 음 유지');
    await page.getByTestId('edit-close').click();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('edit-revert-all').click();
    await page.waitForTimeout(1500);
    [x, y] = await headAt(1);
    await page.mouse.click(x, y);
    ok((await page.getByTestId('edit-note').textContent().catch(() => '')).trim() === before, '원래 악보로 되돌리기');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }
  // ── 2d. 연습 항목 시간 끝 알림 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem('violin-active-session', JSON.stringify({ startedAt: now - 59500, items: [{ key: 'tune', label: '튜닝', minutes: 1 }, { key: 'scale', label: '음계·드론', minutes: 5 }], index: 0, accum: [59000, 0], runningSince: now, lastSeen: now }));
    });
    await page.reload();
    ok(await seen(page.getByTestId('item-alert')), '항목 시간 끝 알림 띠');
    ok(/튜닝 시간이 끝났어요 — 다음: 음계/.test(await page.getByTestId('item-alert').textContent().catch(() => '')), '알림 내용');
    await page.getByTestId('item-alert-next').click();
    await page.waitForTimeout(400);
    ok(await page.getByTestId('item-alert').count() === 0, '다음으로 누르면 알림 닫힘');
    ok(/2 \/ 2/.test(await page.locator('.page.today').textContent().catch(() => '')), '다음 항목으로 넘어감');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }
  // ── 2c. 메트로놈 켜고 채점 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1500);
    await page.getByTestId('to').fill('2');
    await page.waitForTimeout(800);
    await page.getByTestId('score-metro-sound').click();
    await page.getByTestId('score-start').click();
    await page.waitForTimeout(700);
    ok(await seen(page.getByTestId('beat-dot')), '메트로놈 켜고 채점: 박 점 표시');
    await page.waitForTimeout(4500);
    await page.getByTestId('score-stop').click();
    await page.waitForTimeout(1200);
    const res = await page.getByTestId('score-result').textContent();
    const pct = Number(res.match(/(\d+)%/)?.[1]);
    ok(pct >= 80, `메트로놈 켜고 채점 맞은 음 ${pct}%`);
    const legend = () => page.locator('.dev-legend').textContent();
    ok((await legend()).includes('±10센트'), '판정 기준 보통: 범례 ±10');
    await page.getByTestId('tol-relaxed').click();
    await page.waitForTimeout(400);
    ok((await legend()).includes('±15센트') && (await legend()).includes('±30'), '판정 기준 관대: 범례 ±15/±30');
    await page.getByTestId('tol-normal').click();
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2e. 레슨 노트 · 약한 마디 집중 연습 · 발전 그래프 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1800);
    // 레슨 노트 추가 → 체크 → 다시 열어도 유지
    await page.getByTestId('lesson-text').fill('2마디 활 끝까지');
    await page.getByTestId('lesson-measure').fill('2');
    await page.getByTestId('lesson-add').click();
    await page.waitForTimeout(600);
    ok(await seen(page.getByTestId('lesson-top')), '레슨 노트를 쓰면 악보 위 체크리스트에 보임');
    await page.getByTestId('lesson-card').getByTestId('lesson-check').first().click();
    await page.waitForTimeout(600);
    // 약한 마디가 있는 지난 기록 두 개 넣기 (2마디 음을 자주 틀림)
    await page.evaluate(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
      const scores = await new Promise((res) => { const r = dbx.transaction('scores').objectStore('scores').getAll(); r.onsuccess = () => res(r.result); });
      const sid = scores[scores.length - 1].id;
      const tx = dbx.transaction('scoreRuns', 'readwrite');
      const st = tx.objectStore('scoreRuns');
      const now = Date.now();
      for (const [k, pct] of [[2, 60], [1, 70]]) {
        st.add({ createdAt: now - k * 3600e3, date: '2026-10-19', scoreId: sid, title: '스모크 테스트 음계', from: 1, to: 2, durationSec: 20, total: 6, ok: 4, wrong: 2, missed: 0, meanAbs: 6 + k, rhythmMs: 40 + k * 10, bpm: pct, inSession: false,
          notes: [[1, 0, 69, 2, 0, -20], [1, 1, 71, 4, 0, -20], [1, 2, 73, -3, 0, -20], [1, 3, 74, 1, 0, -20], [2, 0, 71, null, 1, null], [2, 1, 74, null, 1, null]] });
      }
      await new Promise((res) => { tx.oncomplete = res; });
    });
    await page.reload();
    await page.waitForTimeout(800);
    if (!(await page.getByTestId('score-view').isVisible().catch(() => false))) {
      await tab(page, '악보');
      await page.getByText('스모크 테스트 음계').first().click();
    }
    await page.waitForTimeout(1500);
    ok(!(await page.getByTestId('lesson-top').isVisible().catch(() => false)), '체크한 레슨 노트는 맨 위 목록에서 빠짐');
    ok(await seen(page.getByTestId('weak-card')), '약한 마디 카드');
    ok(/2마디/.test(await page.getByTestId('weak-card').textContent()), `약한 마디에 2마디 (${(await page.getByTestId('weak-card').textContent()).slice(0, 40)})`);
    ok(await seen(page.getByTestId('run-chart')), '발전 그래프');
    await page.screenshot({ path: 'scripts/shot-practice.png', fullPage: true });
    await page.getByTestId('weak-card').getByTestId('drill-start').first().click();
    await page.waitForTimeout(800);
    ok(await seen(page.getByTestId('drill-card')), '집중 연습 카드');
    ok(Number(await page.getByTestId('from').inputValue()) === 2 && Number(await page.getByTestId('to').inputValue()) === 2, '집중 연습은 그 마디만');
    ok(Number(await page.getByTestId('play-bpm').inputValue()) === 72 * 0.6 || /♩43/.test(await page.getByTestId('drill-card').textContent()), `사다리 60% 템포 (${await page.getByTestId('play-bpm').inputValue()})`);
    await page.getByTestId('score-start').click();
    await page.waitForTimeout(2500);
    await page.getByTestId('score-stop').click();
    await page.waitForTimeout(1500);
    ok(await seen(page.getByTestId('drill-msg')), `채점하면 사다리 결과 (${(await page.getByTestId('drill-msg').textContent().catch(() => '')).slice(0, 50)})`);
    // 오늘 화면: 지난번 약했던 마디 → 집중 연습으로 열기
    await page.getByTestId('drill-end').click();
    await tab(page, '오늘');
    await page.waitForTimeout(800);
    ok(await seen(page.getByTestId('today-weak')), '오늘 화면에 지난번 약했던 마디');
    await page.getByTestId('today-drill').first().click();
    await page.waitForTimeout(2000);
    ok(await seen(page.getByTestId('drill-card')), '오늘 화면에서 바로 집중 연습으로 열기');
    // 기록 화면의 레슨 노트
    await tab(page, '기록');
    await page.locator('.log .segmented').getByRole('button', { name: '연습 기록' }).click();
    ok(await seen(page.getByTestId('lesson-log')), '기록 화면에 레슨 노트');
    await page.getByTestId('lesson-log').getByText('한 것도 보기').click();
    ok(/2마디 활 끝까지/.test(await page.getByTestId('lesson-log').textContent()), '레슨 노트 내용이 기록 화면에 남음');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }
  // ── 2c. 연습곡 생성 (음계·포지션·에튀드) ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('open-exercises').click();
    await page.getByRole('button', { name: '16분음표' }).click();
    await page.getByTestId('ex-C4').click();
    await page.getByTestId('exercise-card').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1500);
    ok((await page.locator('[data-testid=osmd] svg').count()) >= 1, '연습곡 악보 그리기');
    const svgText = await page.locator('[data-testid=osmd] svg').first().textContent();
    ok(/3포지션/.test(svgText) && /1포지션/.test(svgText), '포지션 표시 (1·3포지션)');
    ok(/D장조 음계 2옥타브/.test(await page.locator('.score-title').textContent()), '연습곡 제목');
    ok(Number(await page.getByTestId('play-bpm').inputValue()) === 60, '단계 템포 ♩=60');
    await page.screenshot({ path: 'scripts/shot-exercise.png', fullPage: true });
    await page.getByTestId('play-bpm').fill('200');
    await page.getByTestId('play-toggle').click();
    await page.waitForTimeout(2200);
    ok((await page.locator('[data-testid=osmd] .now-note').count()) > 0, '연습곡 재생 중 현재 음 강조');
    await page.getByTestId('play-toggle').click();
    await page.getByRole('button', { name: '◀ 목록' }).click();
    ok(await seen(page.getByTestId('ex-D1')), '목록으로 돌아오면 연습곡 화면');
    await page.getByTestId('ex-D1').click();
    await page.getByTestId('ex-regen').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const h1 = await page.locator('[data-testid=osmd] svg').first().innerHTML();
    await page.getByTestId('ex-regen').click();
    await page.waitForTimeout(2500);
    const h2 = await page.locator('[data-testid=osmd] svg').first().innerHTML();
    ok(h1 !== h2 && /#2/.test(await page.locator('.score-title').textContent()), '다른 에튀드 만들기');
    await page.screenshot({ path: 'scripts/shot-etude.png', fullPage: true });
    await page.getByRole('button', { name: '◀ 목록' }).click();
    // 활 연습 (세브치크식)
    await page.getByTestId('bow-base').selectOption('cross2');
    await page.getByTestId('bow-7').click();
    await page.getByTestId('bow-next').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    ok(/7\. 4음 슬러/.test(await page.locator('.score-title').textContent()), '활 변형 7 (4음 슬러) 만들기');
    ok(Number(await page.getByTestId('play-bpm').inputValue()) === 50, '활 연습 템포 ♩=50');
    await page.getByTestId('bow-next').click();
    await page.waitForTimeout(2000);
    ok(/8\. 8음 슬러/.test(await page.locator('.score-title').textContent()), '다음 변형으로 넘어가기');
    await page.screenshot({ path: 'scripts/shot-bow.png', fullPage: true });
    await page.getByRole('button', { name: '◀ 목록' }).click();
    await page.getByRole('button', { name: '◀ 목록' }).click();
    ok(/내 악보 0개/.test(await page.locator('.page').textContent()), '연습곡은 내 악보 목록과 따로');
    // 오늘의 연습 → 기초 연습 추천 바로 열기
    await tab(page, '오늘');
    ok(await seen(page.getByTestId('basics-card')), '오늘의 기초 연습 카드');
    const sugText = await page.getByTestId('today-step').textContent();
    await page.getByTestId('today-step').click();
    await page.getByTestId('exercise-card').waitFor({ timeout: 5000 });
    ok(true, `추천 연습곡 바로 열기 (${sugText.slice(0, 30)})`);
    await page.getByRole('button', { name: '◀ 목록' }).click();
    await page.getByRole('button', { name: '◀ 목록' }).click();
    // 악보 폴더
    const chips = await page.getByTestId('folder-chips').textContent();
    ok(/스즈키 4권/.test(chips) && /스즈키 3권/.test(chips) && /기타 곡/.test(chips), `기본 폴더 3개 (${chips})`);
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '◀ 목록' }).click();
    ok(/스모크 테스트 음계/.test(await page.getByTestId('folder-other').textContent()), '제목으로 짐작해 기타 곡 폴더에');
    page.once('dialog', (d) => d.accept('연습용'));
    await page.getByTestId('folder-manage').click();
    await page.getByTestId('folder-add').click();
    await page.waitForTimeout(500);
    ok(/연습용 0/.test(await page.getByTestId('folder-chips').textContent()), '새 폴더 만들기 (선택됨)');
    await page.getByRole('button', { name: /^전체/ }).click();
    const fid = await page.getByTestId('score-folder').first().evaluate((el) => [...el.options].find((o) => o.text === '연습용').value);
    await page.getByTestId('score-folder').first().selectOption(fid);
    await page.waitForTimeout(500);
    const chips2 = await page.getByTestId('folder-chips').textContent();
    ok(/연습용 1/.test(chips2) && /기타 곡 0/.test(chips2), `악보를 다른 폴더로 옮기기 (${chips2})`);
    await page.screenshot({ path: 'scripts/shot-folders.png', fullPage: true });
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2f. 도돌이표대로 듣기 · 조 옮긴 악보 새로 저장 · 열 때 전체 화면 ──
  {
    const { browser, page, errors } = await launch('a445.wav');
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/repeat-score.musicxml'));
    await page.waitForTimeout(1500);
    ok(await seen(page.getByTestId('unfold')), '도돌이표 있는 악보에 "도돌이표대로" 칸');
    ok(await page.getByTestId('unfold').isChecked(), '도돌이표대로 기본으로 켜짐');
    const listen = async () => {
      await page.getByTestId('play-bpm').fill('200');
      await page.getByTestId('play-bpm').blur();
      await page.getByTestId('play-toggle').click();
      const seq = [];
      for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(50);
        const t = await page.locator('.sheet-bar > span').first().textContent();
        const m = t.match(/지금 (\d+)마디/);
        if (m && seq[seq.length - 1] !== Number(m[1])) seq.push(Number(m[1]));
        if (seq.length && !m && i > 20) break;
      }
      await page.waitForTimeout(300);
      return seq;
    };
    const s1 = await listen();
    ok(s1.join(',') === '1,2,1,2,3', `도돌이표대로 듣기: 마디 순서 ${s1.join(',')} (기대 1,2,1,2,3)`);
    ok(await page.locator('.now-note').count() === 0, '다 듣고 나면 강조 지움');
    await page.getByTestId('unfold').uncheck();
    const s2 = await listen();
    ok(s2.join(',') === '1,2,3', `끄면 악보 순서대로: ${s2.join(',')}`);
    ok(await page.evaluate(() => localStorage.getItem('violin-unfold') === '0'), '도돌이표대로 설정 기억 (violin-unfold)');
    // 조 옮겨 새 악보로 저장 → 그 악보가 열림, 원래 악보는 그대로
    await page.getByTestId('transpose-toggle').click();
    await page.getByTestId('transpose-up').click(); await page.getByTestId('transpose-up').click();
    await page.waitForTimeout(800);
    await page.getByTestId('transpose-save').click();
    await page.waitForTimeout(1500);
    const t2 = await page.locator('.score-title').textContent();
    ok(t2 === '스모크 도돌이표 (E장조)', `조 옮긴 새 악보가 열림 (${t2})`);
    ok(await seen(page.getByTestId('open-notice')), '새로 저장했다는 안내');
    ok(!/[+-]\d/.test(await page.getByTestId('transpose-toggle').textContent()), '새 악보는 조 옮김 없이 (이미 옮긴 악보)');
    ok((await page.locator('[data-testid=osmd] svg').count()) >= 1, '새 악보 그리기');
    await page.goBack(); // 휴대폰 뒤로 가기 → 목록 (새 악보로 바꿔 열어도 한 번에)
    await page.waitForTimeout(800);
    ok(await seen(page.getByTestId('score-open')), '뒤로 가기로 목록');
    const titles = await page.locator('[data-testid=score-open] b').allTextContents();
    ok(titles.includes('스모크 도돌이표 (E장조)') && titles.includes('스모크 도돌이표'), `목록에 원래 악보와 새 악보 둘 다 (${titles.join(' / ')})`);
    // 열 때 전체 화면으로: 설정 켜고 다시 연 뒤 첫 터치에
    await tab(page, '오늘');
    await page.getByRole('button', { name: '설정' }).click();
    await page.getByTestId('fullscreen-setting').check();
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => localStorage.getItem('violin-fullscreen') === '1'), '열 때 전체 화면 설정 저장 (violin-fullscreen)');
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await page.reload();
    await page.waitForTimeout(1000);
    ok(await page.evaluate(() => !document.fullscreenElement), '다시 열면 아직 아님 (터치 전)');
    await tab(page, '튜너');
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => !!document.fullscreenElement), '첫 터치에 전체 화면');
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await page.waitForTimeout(400);
    await tab(page, '오늘');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.fullscreenElement), '직접 나가면 돌아올 때까지 다시 안 들어감');
    const m = await (await fetch(URL + 'manifest.webmanifest')).json();
    ok(m.display === 'standalone', `설치한 앱은 standalone 그대로 (${m.display})`);
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2g. 복습함: 틀린 마디 → 오늘 화면 카드 → 그 마디 열기 → 악보 지우면 같이 지움 (a445: A4 +20센트만 계속) ──
  {
    const { browser, page, errors } = await launch('a445.wav');
    const idb = (fn) => page.evaluate(fn);
    await tab(page, '악보');
    await page.getByTestId('score-file').setInputFiles(path.resolve('scripts/test-score.musicxml'));
    await page.waitForTimeout(1500);
    await page.getByTestId('to').fill('2');
    await page.waitForTimeout(500);
    await page.getByTestId('score-start').click();
    await page.waitForTimeout(4000);
    await page.getByTestId('score-stop').click();
    ok(await seen(page.getByTestId('review-msg')), `채점하면 틀린 마디를 복습함에 (${await page.getByTestId('review-msg').textContent().catch(() => '')})`);
    const rows = await idb(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
      const all = await new Promise((res) => { const g = dbx.transaction('reviews').objectStore('reviews').getAll(); g.onsuccess = () => res(g.result); });
      dbx.close();
      return all;
    });
    ok(rows.length >= 1 && rows.every((r) => r.id === `${r.scoreId}:${r.measure}` && r.box === 0), `복습함 DB (reviews, "악보id:마디") ${rows.map((r) => r.id).join(' ')}`);
    ok(!(await page.getByTestId('review-here').isVisible().catch(() => false)), '오늘 넣은 마디는 내일 복습 (악보에 아직 칩 없음)');
    await tab(page, '오늘');
    await page.waitForTimeout(600);
    ok(/오늘 0마디/.test(await page.getByTestId('review-card').textContent().catch(() => '')), '오늘 화면: 오늘 0마디 · 다음 복습 날 안내');
    // 날짜를 당겨 오늘 복습할 것으로
    await idb(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
      const tx = dbx.transaction('reviews', 'readwrite'); const st = tx.objectStore('reviews');
      const all = await new Promise((res) => { const g = st.getAll(); g.onsuccess = () => res(g.result); });
      for (const r of all) st.put({ ...r, due: '2000-01-01' });
      await new Promise((res) => { tx.oncomplete = res; });
      dbx.close();
    });
    await page.reload();
    await page.waitForTimeout(1000);
    ok(await seen(page.getByTestId('review-open')), '오늘 화면에 틀린 마디 복습 (곡·마디)');
    const first = rows.map((r) => r.measure).sort((a, b) => a - b)[0];
    await page.getByTestId('review-open').first().click();
    ok(await seen(page.getByTestId('score-view')), '복습 마디 누르면 그 악보가 열림');
    await page.waitForTimeout(1200);
    ok(Number(await page.getByTestId('from').inputValue()) === first, `그 마디부터 (${await page.getByTestId('from').inputValue()}~${await page.getByTestId('to').inputValue()})`);
    ok(await seen(page.getByTestId('review-here')), '악보에 "오늘 복습할 마디" 칩');
    // 조 옮겨도 마디 번호 기준이라 칩 그대로
    await page.getByTestId('transpose-toggle').click();
    await page.getByTestId('transpose-up').click();
    await page.waitForTimeout(1000);
    ok(await seen(page.getByTestId('review-chip')), '조 옮겨도 복습 마디 칩 그대로');
    await page.getByTestId('transpose-reset').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'scripts/shot-review.png', fullPage: true });
    // 악보 지우면 복습도 지움
    await page.goBack();
    await page.waitForTimeout(800);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '악보 삭제' }).first().click();
    await page.waitForTimeout(800);
    const left = await idb(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
      const n = await new Promise((res) => { const g = dbx.transaction('reviews').objectStore('reviews').count(); g.onsuccess = () => res(g.result); });
      dbx.close();
      return n;
    });
    ok(left === 0, `악보를 지우면 그 복습 마디도 지움 (남은 ${left})`);
    await tab(page, '오늘');
    await page.waitForTimeout(600);
    ok(!(await page.getByTestId('review-card').isVisible().catch(() => false)), '복습할 것이 없으면 카드 숨김');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 2g. 장·단음계 악보 24조 + 조 바꾸기 ──
  {
    const { browser, page, errors } = await launch('phrases.wav');
    await tab(page, '악보');
    await page.getByTestId('open-exercises').click();
    ok(await seen(page.getByTestId('sheet-card')), '연습곡 화면에 장·단음계 악보 카드');
    ok((await page.getByTestId('sheet-card').locator('.sheet-keys .chip').count()) === 12, '장조 12개 칩');
    await page.getByTestId('sheet-Eb').click();
    await page.getByTestId('sheet-nav').waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const title = async () => (await page.locator('.score-title').textContent()) ?? '';
    ok(/E♭장조 음계 · 2옥타브/.test(await title()), `음계 악보 E♭장조 (${await title()})`);
    ok(!/포지션/.test(await page.locator('[data-testid=osmd] svg').first().textContent()), '음계 악보에는 포지션 글씨 없음');
    await page.getByTestId('acc-toggle').click();
    await page.getByTestId('len-chips').getByRole('button', { name: '16마디' }).click();
    await page.waitForTimeout(800);
    const accs = (await page.getByTestId('acc-chip').allTextContents()).join(' ');
    ok(accs === 'B♭ E♭ A♭', `E♭장조 형광펜 칩 (${accs})`);
    await page.getByTestId('acc-toggle').click();
    await page.screenshot({ path: 'scripts/shot-sheet.png', fullPage: true });
    const waitTitle = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.score-title')?.textContent ?? ''), re.source, { timeout: 5000 }).catch(() => {});
    await page.getByTestId('sheet-next').click();
    await waitTitle(/A♭장조/);
    ok(/A♭장조/.test(await title()), '다음 조 → A♭장조');
    await page.getByTestId('sheet-prev').click();
    await waitTitle(/E♭장조/);
    await page.getByTestId('sheet-prev').click();
    await waitTitle(/B♭장조/);
    ok(/B♭장조/.test(await title()), `이전 조 두 번 → B♭장조 (${await title()})`);
    await page.getByTestId('sheet-nav-oct-3').click();
    await waitTitle(/3옥타브/);
    ok(/B♭장조 음계 · 3옥타브/.test(await title()), '3옥타브로 바꾸기');
    await page.getByTestId('sheet-prev').click();
    await waitTitle(/F장조/);
    ok(/F장조 음계 · 2옥타브/.test(await title()) && await page.getByTestId('sheet-nav-oct-3').isDisabled(), `F장조는 E7을 넘어 2옥타브 (${await title()})`);
    await page.getByTestId('sheet-prev').click();
    await waitTitle(/C장조/);
    ok(/C장조 음계 · 3옥타브/.test(await title()), '다음 조에서는 다시 3옥타브');
    await page.getByTestId('sheet-relative').click();
    await waitTitle(/A단조/);
    ok(/A단조 \(화성\) 음계/.test(await title()), `나란한단조 → A단조 (${await title()})`);
    await page.getByTestId('sheet-nav-form-melodic').click();
    await waitTitle(/가락/);
    ok(/A단조 \(가락\) 음계 · 3옥타브/.test(await title()), `단조 형태 바꾸기 (${await title()})`);
    await page.getByTestId('sheet-key').selectOption('G#m');
    await waitTitle(/G♯단조/);
    ok(/G♯단조 \(가락\)/.test(await title()), '조 고르기 → G♯단조');
    await page.screenshot({ path: 'scripts/shot-sheet-nav.png', fullPage: false });
    await page.getByRole('button', { name: '◀ 목록' }).click();
    ok(await seen(page.getByTestId('sheet-card')), '목록으로 돌아오면 연습곡 화면');
    ok(await page.getByTestId('sheet-minor').evaluate((el) => el.classList.contains('on')), '마지막 설정(단조) 기억');
    ok(await seen(page.getByTestId('sheet-G#m')), '단조 12개 칩');
    ok(/F단조·F♯단조는 3옥타브가/.test(await page.getByTestId('sheet-card').textContent()), '3옥타브 안 되는 조 안내');
    await page.getByRole('button', { name: '◀ 목록' }).click();
    ok(/내 악보 0개/.test(await page.locator('.page').textContent()), '음계 악보는 내 악보 목록과 따로');
    const nEx = await page.evaluate(async () => {
      const req = indexedDB.open('violin-practice');
      const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
      const rows = await new Promise((res) => { const g = dbx.transaction('scores').objectStore('scores').getAll(); g.onsuccess = () => res(g.result); });
      dbx.close();
      return rows.filter((r) => r.exercise?.stepId === 'scales').length;
    });
    ok(nEx === 1, `음계 악보는 한 장만 덮어씀 (${nEx})`);
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 3. 비브라토 ──
  {
    const { browser, page, errors } = await launch('vibrato.wav');
    await tab(page, '음정');
    await page.getByTestId('mic-toggle').click();
    await page.getByRole('button', { name: '비브라토' }).click();
    await page.waitForTimeout(3000);
    const t = await page.getByTestId('vibrato-stats').textContent();
    const [rate, width] = [num(t.match(/[\d.]+ Hz/)[0]), num(t.match(/±\d+/)[0])];
    ok(Math.abs(rate - 6) < 0.5, `비브라토 속도 ${rate}Hz (기대 6)`);
    ok(Math.abs(width - 25) <= 6, `비브라토 폭 ±${width} (기대 ±25)`);
    await page.screenshot({ path: 'scripts/shot-vibrato.png', fullPage: true });
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }

  // ── 운지표 (튜너 탭 → 운지표): 음 목록 칩 · 지판 포지션 · 조별 손 모양 · 짚어 보기 (a445: A4 +20센트) ──
  {
    const { browser, page, errors } = await launch('a445.wav');
    await tab(page, '튜너');
    await page.getByTestId('view-chart').click();
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => localStorage.getItem('violin-tuner-view') === 'chart'), '튜너 | 운지표 바꾸기 기억 (violin-tuner-view)');
    const chipN = () => page.getByTestId('spot-chip').count();
    ok((await chipN()) === 228, `음 목록 칩 (반음 모두 · 7포지션까지) ${await chipN()} (기대 228)`);
    await page.getByTestId('maxpos-1').click();
    ok((await chipN()) === 36, `최고 포지션 1 → 칩 ${await chipN()} (기대 36)`);
    await page.getByTestId('maxpos-7').click();
    await page.getByTestId('chart-key').selectOption('2');
    ok((await page.locator('.fc-row').count()) === 23 && (await chipN()) === 129, `D장조만: 음 ${await page.locator('.fc-row').count()}개 · 칩 ${await chipN()} (기대 23 · 129)`);
    ok(/F♯4/.test(await page.getByTestId('note-list').textContent()) && !/F4/.test(await page.getByTestId('note-list').textContent()), 'D장조 철자 F♯ (F 없음)');
    ok((await page.locator('.fc-row .mini-staff').count()) === 23, '음마다 작은 오선');
    await page.reload();
    await page.waitForTimeout(800);
    await tab(page, '튜너');
    ok(await seen(page.getByTestId('note-list')), '다시 열어도 운지표 · 음 목록');
    ok((await page.getByTestId('chart-key').inputValue()) === '2', '고른 조 기억 (violin-fingerchart)');
    // 지판: 포지션 바꾸기
    await page.getByTestId('fc-board').click();
    await page.getByTestId('pos-1').click();
    const rowA = () => page.getByTestId('board-row-A').textContent();
    ok(/1 B4 · 2 C♯5 · 3 D5 · 4 E5/.test(await rowA()), `지판 1포지션 A현 (${await rowA()})`);
    await page.getByTestId('pos-3').click();
    ok(/1 D5 · 2 E5 · 3 F♯5 · 4 G5/.test(await rowA()), `지판 3포지션 A현 (${await rowA()})`);
    ok((await page.getByTestId('board-dot').count()) === 16, `D장조 3포지션 손가락 동그라미 ${await page.getByTestId('board-dot').count()} (기대 16)`);
    await page.getByTestId('chart-key').selectOption('all');
    ok((await page.getByTestId('board-dot').count()) === 32, `반음 모두: 줄마다 8자리 ${await page.getByTestId('board-dot').count()} (기대 32)`);
    await page.screenshot({ path: 'scripts/shot-fingerboard.png', fullPage: true });
    // 조별 손 모양
    await page.getByTestId('fc-shape').click();
    ok(await seen(page.getByText('손 모양은 조를 골라야 보여요')), '반음 모두면 조 고르라는 안내');
    await page.getByTestId('chart-key').selectOption('2');
    await page.getByTestId('pos-1').click();
    const shE = await page.getByTestId('shape-E').textContent(), shG = await page.getByTestId('shape-G').textContent();
    ok(shE.includes('1|2 3 4') && shE.includes('1·2 붙음'), `D장조 1포지션 E현 손 모양 (${shE})`);
    ok(shG.includes('1 2 3|4') && shG.includes('높은 3'), `D장조 1포지션 G현 손 모양 (${shG})`);
    // 짚어 보기: 음 목록에서 A현 개방 고르기 → 마이크 → +20센트
    await page.getByTestId('fc-list').click();
    await page.getByTestId('chart-key').selectOption('all');
    await page.getByTestId('spot-chip').filter({ hasText: /^A현 개방 0$/ }).click();
    await page.getByTestId('fc-practice').click();
    ok((await page.getByTestId('practice-target').textContent()) === 'A현 개방 (A4)', `짚어 보기 목표 (${await page.getByTestId('practice-target').textContent()})`);
    await page.getByTestId('practice-mic').click();
    await page.waitForTimeout(2500);
    const pc = num(await page.getByTestId('practice-cents').textContent());
    ok((await page.getByTestId('practice-now').textContent()) === 'A4' && Math.abs(pc - 20) <= 3, `짚어 보기 지금 음 A4 · ${pc}센트 (기대 +20)`);
    ok(/조금 높아요/.test(await page.getByTestId('practice-msg').textContent()), `기준(±10) 밖이면 안내 (${await page.getByTestId('practice-msg').textContent()})`);
    ok((await page.getByTestId('practice-tally').textContent()) === '맞힘 0 / 시도 0', '아직 맞힘 없음');
    await page.getByTestId('pos-3').click();
    await page.getByTestId('practice-pick').click();
    await page.waitForTimeout(800);
    const tg = await page.getByTestId('practice-target').textContent();
    ok(/^[GDAE]현 3포지션 \d번 \(/.test(tg), `골라 주기: 3포지션 안에서 (${tg})`);
    ok(/반음|온음|옥타브|조금/.test(await page.getByTestId('practice-msg').textContent()), `다른 음이면 얼마나 다른지 (${await page.getByTestId('practice-msg').textContent()})`);
    await page.screenshot({ path: 'scripts/shot-fingerpractice.png', fullPage: true });
    // 기준 A 를 445 로 → a445 소리가 A4 ±0 → 0.5초 이어지면 맞았어요, 다음 자리
    await page.getByTestId('view-tuner').click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '＋' }).click();
    await page.getByTestId('view-chart').click();
    ok(await seen(page.getByTestId('practice-target')), '운지표로 돌아오면 짚어 보기 그대로');
    await page.getByTestId('fc-list').click();
    await page.getByTestId('spot-chip').filter({ hasText: /^A현 개방 0$/ }).click();
    await page.getByTestId('fc-practice').click();
    await page.getByTestId('practice-mic').click();
    let gotRight = false;
    for (let i = 0; i < 40 && !gotRight; i++) { await page.waitForTimeout(100); gotRight = (await page.getByTestId('practice-msg').textContent()) === '맞았어요!'; }
    ok(gotRight, '기준 안에서 0.5초 → 맞았어요');
    await page.waitForTimeout(1500);
    ok((await page.getByTestId('practice-tally').textContent()) === '맞힘 1 / 시도 1', `맞힌 수 / 시도 수 (${await page.getByTestId('practice-tally').textContent()})`);
    ok((await page.getByTestId('practice-target').textContent()) !== 'A현 개방 (A4)', `맞히면 다음 자리 (${await page.getByTestId('practice-target').textContent()})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '휴대폰: 가로 넘침 없음');
    // 태블릿 가로
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.getByTestId('fc-board').click();
    await page.waitForTimeout(300);
    const [bb, sb] = [await page.getByTestId('board').boundingBox(), await page.locator('.fc-board-side').boundingBox()];
    ok(bb && sb && sb.x >= bb.x + bb.width - 1, '태블릿: 지판 옆에 줄별 목록');
    await page.screenshot({ path: 'scripts/shot-fingerboard-tab.png', fullPage: true });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로 넘침 없음');
    ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
    await browser.close();
  }
} catch (e) {
  console.log('FAIL 예외', e.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  process.exit(process.exitCode ?? 0);
}
