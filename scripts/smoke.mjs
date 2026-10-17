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
    ok((await page.getByTestId('bpm').textContent()) === '89', '새로고침 후 BPM 유지');
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
    await page.waitForTimeout(5200);
    await page.getByTestId('score-stop').click();
    await page.waitForTimeout(1200);
    const res = await page.getByTestId('score-result').textContent();
    const pct = Number(res.match(/(\d+)%/)?.[1]);
    ok(pct >= 80, `채점 결과 맞은 음 ${pct}% (${res.match(/맞은 음 \d+\/\d+/)?.[0]})`);
    ok(/B4\+1[0-4]/.test(res), 'B4 +12센트를 가장 벗어난 음으로 표시');
    ok(/녹음/.test(await page.getByTestId('run-saved').textContent().catch(() => '')), '채점하면 연습 기록과 녹음 저장');
    ok(/연습 기록 1번/.test(await page.getByTestId('run-history').textContent().catch(() => '')), '이 악보 연습 기록 표시');
    const colored = await page.locator('[data-testid=osmd] svg path[fill="#ca8a04"], [data-testid=osmd] svg path[fill="#15803d"], [data-testid=osmd] svg [fill="#ca8a04"], [data-testid=osmd] svg [fill="#15803d"]').count();
    ok(colored > 0, `음표 머리 색칠 (${colored})`);
    ok(await seen(page.getByTestId('rhythm-stats')), `박자 채점 표시 (${(await page.getByTestId('rhythm-stats').textContent().catch(() => '')).trim()})`);
    await page.getByTestId('view-rhythm').click();
    await page.waitForTimeout(800);
    ok(/늦게|일찍/.test(await page.getByTestId('rhythm-worst').textContent()), '박자로 보기: 일찍·늦게 음 목록');
    await page.screenshot({ path: 'scripts/shot-rhythm.png', fullPage: true });
    await page.getByTestId('view-pitch').click();
    await page.waitForTimeout(500);
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
    ok(await seen(page.getByTestId('day-runs').locator('audio')), '연습 기록에서 녹음 재생');
    await page.screenshot({ path: 'scripts/shot-runs.png', fullPage: true });
    await page.locator('.log .segmented').first().getByRole('button', { name: '녹음' }).click();
    await page.getByTestId('rec-filter').getByRole('button', { name: '악보 연습' }).click();
    await page.locator('.rec-list .rec-title').first().click();
    ok(/악보 채점: 1~2마디/.test(await page.getByTestId('rec-run').textContent().catch(() => '')), '녹음 목록에 악보 채점 결과 연동');
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
