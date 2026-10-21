import { describe, expect, it, beforeEach } from 'vitest';
import { chartKeyFor, chartPosFor, spelledFrom, spotFromHint } from '../src/violin/fromScore';
import { onFingeringRequest, peekFingeringRequest, requestFingering, takeFingeringRequest } from '../src/state/openRequest';

describe('악보 음 → 운지표 자리', () => {
  it('포지션 추천 자리 그대로 (줄·포지션·손가락)', () => {
    expect(spotFromHint(74, { string: 2, pos: 1, finger: 3 })).toMatchObject({ string: 2, pos: 1, finger: 3, open: false });
    expect(spotFromHint(74, { string: 1, pos: 4, finger: 4 })).toMatchObject({ string: 1, pos: 4, finger: 4 });
  });
  it('손가락 0 은 개방현 (포지션은 상관없음)', () => {
    expect(spotFromHint(69, { string: 2, pos: 3, finger: 0 })).toMatchObject({ string: 2, open: true });
    expect(spotFromHint(69, { finger: 0 })).toMatchObject({ string: 2, open: true });
  });
  it('내 표시 손가락·포지션만 있어도 맞는 자리', () => {
    expect(spotFromHint(74, { finger: 3 })).toMatchObject({ string: 2, pos: 1, finger: 3 });
    expect(spotFromHint(74, { pos: 3 })).toMatchObject({ pos: 3 });
    // 맞는 포지션이 없으면 손가락만으로
    expect(spotFromHint(74, { pos: 7, finger: 3 })).toMatchObject({ finger: 3 });
  });
  it('자리 정보가 없거나 맞는 자리가 없으면 음만', () => {
    expect(spotFromHint(74)).toBeNull();
    expect(spotFromHint(74, {})).toBeNull();
    expect(spotFromHint(50, { finger: 1 })).toBeNull();
  });
  it('조 거르기: 지금 조에 있으면 그대로, 없으면 악보 조표의 장조, 그것도 아니면 반음 모두', () => {
    expect(chartKeyFor(73, null, 2)).toBeNull();
    expect(chartKeyFor(73, 2, 0)).toBe(2);
    expect(chartKeyFor(73, 0, 2)).toBe(2);
    expect(chartKeyFor(73, 0, undefined)).toBeNull();
    expect(chartKeyFor(73, 0, -6)).toBeNull(); // 운지표에 없는 조
    expect(chartKeyFor(70, 0, 2)).toBeNull(); // B♭ 은 라장조에도 없음
  });
  it('포지션: 자리 포지션 > 지금 포지션 > 가장 낮은 자리', () => {
    expect(chartPosFor(74, spotFromHint(74, { string: 1, pos: 4, finger: 4 }), 1)).toBe(4);
    expect(chartPosFor(69, spotFromHint(69, { finger: 0 }), 3)).toBe(3);
    expect(chartPosFor(74, null, 1)).toBe(1);
    expect(chartPosFor(88, null, 1)).toBe(4); // E6: 1포지션에 없음 → 4포지션 4번
  });
  it('음 철자: 악보 철자 그대로, 안 맞으면 샵', () => {
    expect(spelledFrom(70, 'B', -1)).toEqual({ midi: 70, step: 'B', alter: -1, octave: 4 });
    expect(spelledFrom(72, 'B', 1)).toEqual({ midi: 72, step: 'B', alter: 1, octave: 4 });
    expect(spelledFrom(70)).toEqual({ midi: 70, step: 'A', alter: 1, octave: 4 });
    expect(spelledFrom(70, 'C', 0)).toEqual({ midi: 70, step: 'A', alter: 1, octave: 4 });
  });
});

describe('requestFingering', () => {
  beforeEach(() => { takeFingeringRequest(); });
  it('요청 알림 → 엿보기 → 한 번만 가져가기', () => {
    const got: number[] = [];
    const off = onFingeringRequest((r) => got.push(r.midi));
    requestFingering({ midi: 73, back: { scoreId: 1, title: 'x', measure: 1, from: 1, to: 2 } });
    expect(got).toEqual([73]);
    expect(peekFingeringRequest()?.midi).toBe(73);
    expect(takeFingeringRequest()?.back?.to).toBe(2);
    expect(takeFingeringRequest()).toBeNull();
    off();
    requestFingering({ midi: 60 });
    expect(got).toEqual([73]);
  });
});
