/** 다른 화면(오늘)에서 악보를 특정 마디·집중 연습으로 바로 열기 */
export interface ScoreOpenRequest { scoreId: number; measure?: number; drill?: boolean }
let pending: ScoreOpenRequest | null = null;
export const requestScore = (r: ScoreOpenRequest) => { pending = r; };
export const takeScoreRequest = () => { const p = pending; pending = null; return p; };
