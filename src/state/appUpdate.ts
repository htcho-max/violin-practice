import { registerSW } from 'virtual:pwa-register';

const KEY = 'violin-app-version';
let registration: ServiceWorkerRegistration | undefined;

/** 새 버전은 자동으로 받아서 새로고침됩니다. 이전에 쓰던 버전과 다르면 알림용으로 true */
export function setupUpdates(): { updatedFrom: string | null } {
  registerSW({
    immediate: true,
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
