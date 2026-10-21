import type { Scored } from '../score/align';
import type { ReviewItem } from './db';
import { addDays } from './dates';

/** 복습 간격 (일). box 0 → 1일 뒤, … 마지막 칸을 넘으면 졸업 */
export const REVIEW_DAYS = [1, 2, 4, 7, 14, 30];
/**
 * 음정 판정 기준 (설정의 엄격·보통·관대 — score/tolerance.ts 의 Tolerance 를 그대로 넘겨도 됨).
 * 마디가 "틀림" = 놓치거나 다른 음이 있거나, 맞은 음 평균이 노랑 한계(warn) 밖.
 * "깨끗함" = 모두 맞고 평균이 초록과 노랑 한계의 가운데 안 (보통이면 ±20 / ±15)
 */
export interface PitchLimits { good: number; warn: number }
const NORMAL: PitchLimits = { good: 10, warn: 20 };
const cleanLimit = (t: PitchLimits) => (t.good + t.warn) / 2;

export interface MeasureStat { measure: number; total: number; ok: number; meanAbs: number | null }

/** 채점 결과 → 마디별 맞은 음·평균 오차. 연주를 멈춘 뒤의 마디(모두 놓침)는 빼요 */
export function measureStats(rs: Scored[]): MeasureStat[] {
  let lastPlayed = -1;
  rs.forEach((r, i) => { if (r.status !== 'missed') lastPlayed = i; });
  if (lastPlayed < 0) return [];
  const lastMeasure = rs[lastPlayed].note.measure;
  const by = new Map<number, MeasureStat & { sum: number }>();
  for (const r of rs) {
    const m = r.note.measure;
    if (m > lastMeasure) continue;
    const s = by.get(m) ?? { measure: m, total: 0, ok: 0, meanAbs: null, sum: 0 };
    s.total++;
    if (r.status === 'ok') { s.ok++; s.sum += Math.abs(r.cents ?? 0); }
    by.set(m, s);
  }
  return [...by.values()].map(({ sum, ...s }) => ({ ...s, meanAbs: s.ok ? sum / s.ok : null }));
}
export const isWeak = (m: MeasureStat, t: PitchLimits = NORMAL) => m.total > 0 && (m.ok < m.total || (m.meanAbs ?? 0) > t.warn);
export const isClean = (m: MeasureStat, t: PitchLimits = NORMAL) => m.total > 0 && m.ok === m.total && (m.meanAbs === null || m.meanAbs <= cleanLimit(t));

export interface ReviewChange { put: ReviewItem[]; del: string[]; added: number[]; again: number[]; advanced: number[]; graduated: number[] }

export const reviewId = (scoreId: number, measure: number) => `${scoreId}:${measure}`;

/**
 * 한 번 채점한 결과로 복습함 바꾸기 (마디 번호 기준 — 조 옮김·도돌이표대로 듣기와 상관없음).
 * - 틀린 마디: 새로 넣거나(내일 복습) 이미 있으면 처음 칸으로
 * - 복습 날이 된 마디를 깨끗하게 치면 다음 칸으로 (마지막 칸이면 졸업)
 * - 아직 복습 날이 아닌 마디는 깨끗해도 그대로 (하루에 여러 번 쳐서 졸업하지 않게)
 */
export function reviewChanges(existing: Map<string, ReviewItem>, stats: MeasureStat[], scoreId: number, title: string, today: string, tol: PitchLimits = NORMAL): ReviewChange {
  const out: ReviewChange = { put: [], del: [], added: [], again: [], advanced: [], graduated: [] };
  for (const s of stats) {
    const id = reviewId(scoreId, s.measure);
    const cur = existing.get(id);
    const pct = Math.round((s.ok / s.total) * 100);
    const base = { last: today, lastPct: pct, lastCents: s.meanAbs === null ? null : Math.round(s.meanAbs) };
    if (isWeak(s, tol)) {
      if (cur) {
        out.put.push({ ...cur, ...base, title, box: 0, due: addDays(today, REVIEW_DAYS[0]) });
        if (cur.due <= today || cur.box > 0) out.again.push(s.measure);
      } else {
        out.put.push({ id, scoreId, measure: s.measure, title, box: 0, due: addDays(today, REVIEW_DAYS[0]), added: today, ...base });
        out.added.push(s.measure);
      }
    } else if (cur && cur.due <= today && isClean(s, tol)) {
      const box = cur.box + 1;
      if (box >= REVIEW_DAYS.length) { out.del.push(id); out.graduated.push(s.measure); } else {
        out.put.push({ ...cur, ...base, title, box, due: addDays(today, REVIEW_DAYS[box]) });
        out.advanced.push(s.measure);
      }
    }
  }
  return out;
}

export function reviewMessage(c: ReviewChange): string | null {
  const parts: string[] = [];
  const ms = (a: number[]) => a.join('·');
  if (c.added.length) parts.push(`${ms(c.added)}마디를 복습함에 넣었어요`);
  if (c.again.length) parts.push(`${ms(c.again)}마디는 처음부터 다시`);
  if (c.advanced.length) parts.push(`${ms(c.advanced)}마디 복습 통과 (다음 복습은 더 나중에)`);
  if (c.graduated.length) parts.push(`${ms(c.graduated)}마디 졸업!`);
  return parts.length ? parts.join(' · ') : null;
}

/** 오늘 복습할 것: 악보별로 묶음 */
export function dueGroups(items: ReviewItem[], today: string): { scoreId: number; title: string; measures: ReviewItem[] }[] {
  const m = new Map<number, { scoreId: number; title: string; measures: ReviewItem[] }>();
  for (const it of items) {
    if (it.due > today) continue;
    const g = m.get(it.scoreId) ?? { scoreId: it.scoreId, title: it.title, measures: [] };
    g.measures.push(it);
    m.set(it.scoreId, g);
  }
  for (const g of m.values()) g.measures.sort((a, b) => a.measure - b.measure);
  return [...m.values()];
}

/** 이어진 마디끼리 묶기: [3,4,5,9] → [[3,5],[9,9]] */
export function measureRuns(ms: number[]): [number, number][] {
  const s = [...new Set(ms)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const m of s) {
    const l = out[out.length - 1];
    if (l && m === l[1] + 1) l[1] = m; else out.push([m, m]);
  }
  return out;
}
