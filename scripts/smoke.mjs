// 빌드본으로 전체 흐름 확인: 튜너(가짜 마이크 445Hz), 메트로놈, 드론, 연습 세션 → 기록
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const wav = path.resolve('scripts/a445.wav');
const server = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) process.exitCode = 1; };
try {
  await page.goto('http://localhost:4319/');
  await page.screenshot({ path: 'scripts/shot-today.png' });

  // 튜너
  await page.getByRole('button', { name: '튜너' }).click();
  await page.getByRole('button', { name: '마이크 켜기' }).click();
  await page.waitForTimeout(2500);
  const note = await page.getByTestId('note').textContent();
  const cents = Number((await page.getByTestId('cents').textContent()).replace(/[^\d+-]/g, ''));
  ok(note === 'A4', `튜너 음이름 = ${note}`);
  ok(Math.abs(cents - 20) <= 3, `튜너 센트 = ${cents} (기대 +20)`);
  await page.screenshot({ path: 'scripts/shot-tuner.png' });
  await page.getByRole('button', { name: '현 선택' }).click();
  await page.waitForTimeout(800);
  const c2 = Number((await page.getByTestId('cents').textContent()).replace(/[^\d+-]/g, ''));
  ok(Math.abs(c2 - 20) <= 3, `A현 선택 센트 = ${c2}`);

  // 메트로놈
  await page.getByRole('button', { name: '메트로놈' }).click();
  await page.getByRole('button', { name: '+5' }).click();
  ok((await page.getByTestId('bpm').textContent()) === '85', 'BPM 80 → 85');
  await page.getByTestId('metro-toggle').click();
  await page.waitForTimeout(1500);
  const lit = await page.locator('.dot.on').count();
  ok(lit === 1, `박 표시 켜짐 (${lit})`);
  await page.screenshot({ path: 'scripts/shot-metronome.png' });

  // 드론 (메트로놈은 다른 탭에서도 계속)
  await page.getByRole('button', { name: '음정' }).click();
  ok(await page.locator('.statusbar').getByText('메트로놈 85').isVisible(), '다른 탭에서 메트로놈 상태 표시');
  await page.getByRole('button', { name: 'A단조' }).click();
  await page.getByTestId('drone-toggle').click();
  await page.getByRole('button', { name: '마이크 켜고 음정 보기' }).click();
  await page.waitForTimeout(2000);
  const droneText = await page.locator('.drone-reading').textContent();
  ok(/A4/.test(droneText) && /옥타브/.test(droneText), `드론 기준 읽기: ${droneText}`);
  await page.screenshot({ path: 'scripts/shot-drone.png', fullPage: true });
  await page.locator('.statusbar').getByRole('button', { name: '■' }).click();

  // 연습 세션 (시계를 빠르게 하기 위해 Date.now 대신 실제 2초)
  await page.getByRole('button', { name: '오늘' }).click();
  await page.getByTestId('session-start').click();
  await page.waitForTimeout(2200);
  await page.getByTestId('session-next').click();
  ok((await page.getByTestId('session-item').textContent()) === '음계·드론', '다음 항목으로 이동');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'scripts/shot-session.png' });
  await page.getByTestId('session-finish').click();
  await page.getByPlaceholder(/메모/).fill('스모크 테스트');
  await page.getByTestId('session-save').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '기록' }).click();
  await page.waitForTimeout(500);
  ok(await page.getByText('스모크 테스트').isVisible(), '기록에 세션 저장');
  await page.screenshot({ path: 'scripts/shot-log.png', fullPage: true });

  // 새로고침 후 설정 유지
  await page.reload();
  await page.getByRole('button', { name: '메트로놈' }).click();
  ok((await page.getByTestId('bpm').textContent()) === '85', '새로고침 후 BPM 유지');
  ok(errors.length === 0, `콘솔 오류 없음 ${errors.join(' | ')}`);
} finally {
  await browser.close();
  server.kill();
}
