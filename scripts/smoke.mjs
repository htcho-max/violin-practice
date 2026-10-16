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
    ok(await seen(page.getByRole('button', { name: '전체 6' })), '4권 곡 6개 기본 등록');
    await page.getByTestId('seed-old').click();
    await page.waitForTimeout(300);
    ok(await seen(page.getByRole('button', { name: '전체 42' })), '1~3권 불러오기 → 42곡');
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
    await page.getByRole('button', { name: '연습 기록' }).click();
    await page.screenshot({ path: 'scripts/shot-log.png', fullPage: true });
    ok((await page.getByText('스모크 테스트').count()) >= 1, `세션 메모 저장 (${await page.getByText('스모크 테스트').count()})`);
    ok(await page.getByText(/곡 구간 연습 · 자이츠/).isVisible(), '세션에 곡 이름 기록');

    // 녹음 2개 → 비교
    await page.getByRole('button', { name: '녹음', exact: true }).click();
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
    const colored = await page.locator('[data-testid=osmd] svg path[fill="#ca8a04"], [data-testid=osmd] svg path[fill="#15803d"], [data-testid=osmd] svg [fill="#ca8a04"], [data-testid=osmd] svg [fill="#15803d"]').count();
    ok(colored > 0, `음표 머리 색칠 (${colored})`);
    await page.screenshot({ path: 'scripts/shot-score.png', fullPage: true });
    // 악보 듣기: 재생 중 현재 음 강조, 끝나면 버튼 복귀
    await page.getByTestId('play-bpm').fill('200');
    await page.getByTestId('play-toggle').click();
    await page.waitForTimeout(1600);
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
    const order = await page.evaluate(() => { const a = document.querySelector('[data-testid=play-card]'), b = document.querySelector('.score-sheet'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); });
    ok(order, '메뉴가 악보 위에 있음');
    await page.screenshot({ path: 'scripts/shot-layout.png', fullPage: true });
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
