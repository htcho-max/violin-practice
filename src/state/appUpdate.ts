import { registerSW } from 'virtual:pwa-register';
import { recorder } from '../audio/recorder';
import { scorePlayer } from '../score/player';
import { pitchTracker } from '../audio/pitchTracker';

const KEY = 'violin-app-version';
let registration: ServiceWorkerRegistration | undefined;

/** 녹음·채점·재생·마이크 사용 중에는 새로고침하지 않음 */
function busy(): boolean {
  return recorder.recording || scorePlayer.playing || pitchTracker.running;
}

/** 새 버전은 받아 두었다가, 연습 중이 아닐 때 새로고침합니다. 이전에 쓰던 버전과 다르면 알림용으로 true */
export function setupUpdates(): { updatedFrom: string | null } {
  let waiting: ReturnType<typeof setInterval> | null = null;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (waiting) return;
      const tryApply = () => {
        if (busy()) return;
        if (waiting) clearInterval(waiting);
        updateSW(true);
      };
      waiting = setInterval(tryApply, 5000);
      tryApply();
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      // 앱이 오래 열려 있어도 1시간마다 새 버전 확인
      if (reg) setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
    },
  });
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, __APP_VERSION__);
  } catch { /* 무시 */ }
  return { updatedFrom: prev && prev !== __APP_VERSION__ ? prev : null };
}

/** 설정의 "업데이트 확인" 버튼 */
export async function checkForUpdate(): Promise<'checked' | 'unsupported'> {
  if (!registration) return 'unsupported';
  await registration.update();
  return 'checked';
}
