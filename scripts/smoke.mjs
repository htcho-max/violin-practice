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
    await page.waitForTimeout(400);
    await page.getByTestId('mark-close').click();
    await page.waitForTimeout(300);
    const labels = await page.getByTestId('mark-label').allTextContents();
    ok(labels.join(' ').includes('∏') && labels.join(' ').includes('p'), `악보 위 내 표시 (${labels.join(' / ')})`);
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
} catch (e) {
  console.log('FAIL 예외', e.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  process.exit(process.exitCode ?? 0);
}
