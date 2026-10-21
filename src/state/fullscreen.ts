import { useEffect, useState } from 'react';

/** 전체 화면 (브라우저 주소창·휴대폰 상태 표시줄 숨김). 아이폰 사파리는 지원 안 함 → 홈 화면에 추가 */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fsSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}
export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}
/** 전체 화면으로 (누르는 순간에만 들어갈 수 있어요) */
export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch { return false; } // 사용자가 막았거나 지원 안 함
}
export async function toggleFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) { await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()); return; }
    await enterFullscreen();
  } catch { /* 사용자가 막았거나 지원 안 함 */ }
}
/**
 * 앱 자체가 이미 전체 화면으로 열렸는지 (홈 화면 앱을 전체 화면 모드로 띄운 경우).
 * 크롬은 전체 화면 API 로 들어가도 display-mode: fullscreen 이 맞으므로, 그때는 아님.
 */
export function appFullscreen(): boolean {
  if (typeof window === 'undefined') return false;
  const d = document as FsDoc;
  return window.matchMedia?.('(display-mode: fullscreen)').matches === true && !d.fullscreenElement && !d.webkitFullscreenElement;
}
/** 전체 화면 버튼·설정을 보여 줄지 (지원하고, 앱이 이미 전체 화면이 아닐 때) */
export const fsUsable = () => fsSupported() && !appFullscreen();

const PREF = 'violin-fullscreen';
/** "열 때 전체 화면으로" 설정 (이 기기에만) */
export const fullscreenPref = () => { try { return localStorage.getItem(PREF) === '1'; } catch { return false; } };
export const setFullscreenPref = (on: boolean) => { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch { /* 무시 */ } };

/**
 * "열 때 전체 화면으로"가 켜져 있으면: 앱을 열거나 다른 앱에서 돌아온 뒤 첫 터치에 전체 화면으로.
 * 브라우저는 사용자가 누르는 순간에만 전체 화면을 허락해서, 여는 순간이 아니라 첫 터치 때 들어가요.
 * 홈 화면 앱(standalone)도 같아요: 다른 앱에 갔다 오면 안드로이드가 전체 화면을 풀어서, 돌아온 뒤 첫 터치에 다시 들어가요.
 * 사용자가 뒤로 버튼·⤡ 로 직접 나가면 다음에 돌아올 때까지는 다시 들어가지 않아요.
 */
export function useAutoFullscreen() {
  useEffect(() => {
    if (!fsUsable()) return;
    let armed = fullscreenPref();
    const tap = (e: Event) => {
      if (!armed || isFullscreen()) return;
      // 전체 화면 버튼·설정 칸을 누른 거면 그 버튼이 알아서 (두 번 들어가거나 바로 나오지 않게)
      const t = e.target as Element | null;
      if (t?.closest?.('[data-testid=fullscreen], [data-testid=fullscreen-setting]')) { armed = false; return; }
      armed = false;
      void enterFullscreen();
    };
    const vis = () => { if (document.visibilityState === 'visible') armed = fullscreenPref(); };
    window.addEventListener('pointerup', tap, true);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pageshow', vis);
    return () => { window.removeEventListener('pointerup', tap, true); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pageshow', vis); };
  }, []);
}
export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => (typeof document !== 'undefined' ? isFullscreen() : false));
  useEffect(() => {
    const f = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', f);
    document.addEventListener('webkitfullscreenchange', f);
    return () => { document.removeEventListener('fullscreenchange', f); document.removeEventListener('webkitfullscreenchange', f); };
  }, []);
  return on;
}
/** 홈 화면 앱(PWA)으로 열었는지 */
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
