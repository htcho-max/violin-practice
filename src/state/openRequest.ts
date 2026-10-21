/** 다른 화면(오늘)에서 악보를 특정 마디·집중 연습으로 바로 열기 */
export interface ScoreOpenRequest { scoreId: number; measure?: number; /** 끝 마디 (주면 measure~to 구간으로) */ to?: number; drill?: boolean; /** 이 연습 기록의 분석을 보여주며 열기 */ runId?: number }
let pending: ScoreOpenRequest | null = null;
export const requestScore = (r: ScoreOpenRequest) => { pending = r; };
export const takeScoreRequest = () => { const p = pending; pending = null; return p; };

/** 악보에서 음표를 길게 눌러 운지표에서 그 음 보기 */
export interface FingeringRequest {
  midi: number; step?: string; alter?: number;
  /** 그 음을 짚을 자리 (포지션 추천·내 표시·인쇄된 손가락에서). 없으면 음만 */
  spot?: { string?: number; pos?: number; finger?: number };
  /** 그때 조표 (샵+/플랫−) — 운지표 조 거르기에 없으면 이 장조로 */
  fifths?: number;
  /** 운지표에서 "◀ 악보로" 돌아갈 곳 */
  back?: { scoreId: number; title: string; measure: number; from: number; to: number };
}
let pendingFg: FingeringRequest | null = null;
const fgListeners = new Set<(r: FingeringRequest) => void>();
export const requestFingering = (r: FingeringRequest) => { pendingFg = r; fgListeners.forEach((f) => f(r)); };
export const peekFingeringRequest = () => pendingFg;
export const takeFingeringRequest = () => { const p = pendingFg; pendingFg = null; return p; };
/** 요청이 오면 (App: 튜너 탭으로) */
export function onFingeringRequest(fn: (r: FingeringRequest) => void) { fgListeners.add(fn); return () => { fgListeners.delete(fn); }; }
