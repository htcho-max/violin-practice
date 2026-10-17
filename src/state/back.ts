import { useEffect, useRef } from 'react';

/**
 * 휴대폰 뒤로 가기 버튼을 앱 안의 "이전 화면"으로.
 * 열린 화면(층)마다 history 항목을 하나씩 쌓고, popstate 가 오면 맨 위 층을 닫는다.
 * 앱 버튼으로 닫으면 쌓아 둔 history 항목을 조용히 되돌린다.
 */
type Layer = { id: number; onBack: () => void };
const stack: Layer[] = [];
let seq = 0;
let skip = 0; // 우리가 부른 history.back() 으로 생긴 popstate 는 무시
let exitWarn: (() => void) | null = null;
let installed = false;
const GUARD = { violinGuard: true };

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // 맨 아래 보호 층: 첫 화면에서 뒤로 가기를 한 번은 막고 안내
  try { history.replaceState({ violinBase: true }, ''); history.pushState(GUARD, ''); } catch { /* 무시 */ }
  window.addEventListener('popstate', () => {
    if (skip > 0) { skip--; return; }
    const top = stack.pop();
    if (top) { top.onBack(); return; }
    // 보호 층이 빠졌음 → 안내만 하고, 한 번 더 누르면 앱이 닫힘
    exitWarn?.();
  });
}

export function setExitWarning(fn: (() => void) | null) { exitWarn = fn; }
/** 안내 뒤 다시 앱을 쓰기 시작하면 보호 층 복구 */
export function restoreGuard() {
  try { if (!(history.state && history.state.violinGuard) && stack.length === 0) history.pushState(GUARD, ''); } catch { /* 무시 */ }
}

/** active 인 동안 뒤로 가기가 onBack 을 부른다 */
export function useBackLayer(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    install();
    if (!active) return;
    restoreGuard();
    const layer: Layer = { id: ++seq, onBack: () => { closedByBack = true; cb.current(); } };
    let closedByBack = false;
    stack.push(layer);
    try { history.pushState({ violinLayer: layer.id }, ''); } catch { /* 무시 */ }
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      if (!closedByBack) { skip++; try { history.back(); } catch { skip--; } }
    };
  }, [active]);
}
