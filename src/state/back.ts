import { useEffect, useRef } from 'react';

/**
 * 휴대폰 뒤로 가기 버튼을 앱 안의 "이전 화면"으로.
 * 열린 화면(층)마다 history 항목을 하나씩 쌓는다 (state: { boot, layer }).
 * - 뒤로 가기로 어떤 항목에 도착하면, 그보다 나중에 쌓인 층을 모두 닫는다.
 * - 앱 버튼으로 닫은 층의 항목은 그대로 두고(history.back 경쟁을 피하려고), 나중에 뒤로 가기로 거기 도착하면 조용히 한 번 더 뒤로 간다.
 * - 맨 아래에는 보호 항목(guard)이 있어서, 첫 화면에서 뒤로 가기를 한 번은 막고 안내한다.
 */
type Layer = { id: number; onBack: () => void };
const BOOT = Math.random().toString(36).slice(2);
const stack: Layer[] = [];
let seq = 0;
let exitWarn: (() => void) | null = null;
let installed = false;
type St = { boot?: string; layer?: number; guard?: boolean; base?: boolean } | null;

function closeAbove(id: number) {
  // 나중에 열린 층부터 닫기
  for (let i = stack.length - 1; i >= 0 && stack[i].id > id; i--) {
    const l = stack.pop()!;
    l.onBack();
  }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try { history.replaceState({ boot: BOOT, base: true }, ''); history.pushState({ boot: BOOT, guard: true }, ''); } catch { /* 무시 */ }
  window.addEventListener('popstate', (e) => {
    const st = e.state as St;
    if (st?.layer !== undefined) {
      const mine = st.boot === BOOT;
      closeAbove(mine ? st.layer : -1);
      // 이미 닫힌 층(또는 지난번 실행의 층)이면 한 번 더 뒤로
      if (!mine || !stack.some((l) => l.id === st.layer)) { try { history.back(); } catch { /* 무시 */ } }
      return;
    }
    closeAbove(-1);
    if (st?.guard) return; // 첫 화면
    // 보호 항목을 지나 맨 아래로 왔음 → 한 번 더 누르면 앱이 닫힌다고 안내
    exitWarn?.();
  });
}

export function setExitWarning(fn: (() => void) | null) { exitWarn = fn; }
/** 안내 뒤 다시 앱을 쓰기 시작하면 보호 항목 복구 */
export function restoreGuard() {
  try {
    const st = history.state as St;
    if (st?.base && stack.length === 0) history.pushState({ boot: BOOT, guard: true }, '');
  } catch { /* 무시 */ }
}

/** active 인 동안 뒤로 가기가 onBack 을 부른다 */
export function useBackLayer(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    install();
    if (!active) return;
    restoreGuard();
    const layer: Layer = { id: ++seq, onBack: () => cb.current() };
    stack.push(layer);
    try { history.pushState({ boot: BOOT, layer: layer.id }, ''); } catch { /* 무시 */ }
    return () => {
      const i = stack.indexOf(layer);
      if (i < 0) return; // 뒤로 가기로 닫힌 층
      stack.splice(i, 1);
      // 앱 버튼으로 닫았고 그 항목이 아직 맨 위면 조용히 걷어냄 (그 사이 새 층이 쌓였으면 그대로 두고 나중에 건너뜀)
      setTimeout(() => {
        try { const st = history.state as St; if (st?.boot === BOOT && st.layer === layer.id) history.back(); } catch { /* 무시 */ }
      }, 0);
    };
  }, [active]);
}
