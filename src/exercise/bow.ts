import { type Key, scalePitch, dOf } from './theory';
import type { BowPattern } from './build';
import type { Phrase, PNote } from './patterns';

/**
 * 세브치크 Op.2 방식: 짧은 기본 악구 하나를 여러 가지 활 쓰기로 반복.
 * 기본 악구는 앱이 만든 것 (16분음표 32개 = 2마디 + 마침음).
 */
export type BowBaseId = 'open' | 'scale' | 'cross2' | 'cross3';
export const BOW_BASES: { id: BowBaseId; label: string; tip: string; keys: boolean }[] = [
  { id: 'open', label: '개방현 건너기', tip: '왼손은 쉬고 활만 생각해요. 현을 바꿀 때 팔 높이를 미리 옮겨요.', keys: false },
  { id: 'scale', label: '음계 2옥타브', tip: '음계는 익숙하니 활 소리와 배분에만 집중해요.', keys: true },
  { id: 'cross2', label: '두 현 건너기', tip: '손목과 손가락으로 작게 건너요. 팔은 두 현 사이 높이에 둬요.', keys: true },
  { id: 'cross3', label: '세 현 분산화음', tip: '가운데 현을 지날 때 소리가 끊기지 않게 활을 둥글게 움직여요.', keys: true },
];
export const BOW_KEYS = ['G', 'D', 'A'];

/** 기본 악구의 온음계 위치 (으뜸음 = 0) */
const DEGREES: Record<Exclude<BowBaseId, 'open'>, { beats: number[][]; final: number }> = {
  scale: { beats: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 13], [12, 11, 10, 9], [8, 7, 6, 5], [4, 3, 2, 1], [0, 1, 2, 1]], final: 0 },
  cross2: { beats: [[7, 9, 7, 9], [7, 11, 7, 11], [6, 10, 6, 10], [6, 11, 6, 11], [5, 10, 5, 10], [5, 9, 5, 9], [4, 8, 4, 8], [4, 10, 4, 10]], final: 7 },
  cross3: { beats: [[0, 4, 9, 4], [2, 7, 11, 7], [3, 7, 10, 7], [5, 10, 12, 10], [1, 4, 8, 4], [6, 8, 11, 8], [2, 7, 11, 7], [0, 4, 9, 4]], final: 0 },
};
const OPEN = [[0, 1, 0, 1], [1, 2, 1, 2], [2, 3, 2, 3], [3, 2, 3, 2], [2, 1, 2, 1], [1, 0, 1, 0], [0, 1, 2, 3], [3, 2, 1, 0]];
const OPEN_D = [dOf('G', 3), dOf('D', 4), dOf('A', 4), dOf('E', 5)];

/** 으뜸음 위치 (D장조 음계는 위쪽이 3포지션) */
const TONIC: Record<string, number> = { G: dOf('G', 3), D: dOf('D', 4), A: dOf('A', 3) };

export function bowBase(key: Key, base: BowBaseId): Phrase[] {
  if (base === 'open') {
    return [OPEN.flat().map((s) => ({ p: { d: OPEN_D[s], alter: 0 } })), [{ p: { d: OPEN_D[0], alter: 0 } }]];
  }
  const t = TONIC[key.id] ?? key.startD;
  const spec = DEGREES[base];
  const flat = spec.beats.flat();
  const notes: PNote[] = flat.map((g, i) => ({ p: scalePitch(key, t + g, i > 0 && g < flat[i - 1] ? -1 : 1, 'harmonic') }));
  return [notes, [{ p: scalePitch(key, t + spec.final, 1) }]];
}

export interface BowVariant { id: string; label: string; pattern: BowPattern; tip: string }
export const BOW_VARIANTS: BowVariant[] = [
  { id: '1', label: '한 음씩 (데타셰)', pattern: { groups: [1], words: '활 가운데' }, tip: '활 가운데에서 고르게. 내림활과 올림활 소리가 같도록.' },
  { id: '2', label: '활 끝에서 한 음씩', pattern: { groups: [1], words: '활 끝' }, tip: '활 끝에서는 검지에 무게를 조금 더 실어요.' },
  { id: '3', label: '활 아래에서 한 음씩', pattern: { groups: [1], words: '활 아래' }, tip: '손잡이 쪽에서는 무게를 덜고 새끼손가락으로 균형을 잡아요.' },
  { id: '4', label: '올림활로 시작', pattern: { groups: [1], upBow: true, words: '활 가운데' }, tip: '박의 첫 음이 올림활이 되어도 강세가 생기지 않게.' },
  { id: '5', label: '2음 슬러', pattern: { groups: [2] }, tip: '슬러 안 두 음의 활 길이를 똑같이 나눠요.' },
  { id: '6', label: '2음 슬러 · 올림활 시작', pattern: { groups: [2], upBow: true }, tip: '올림활 슬러에서 둘째 음이 작아지지 않게.' },
  { id: '7', label: '4음 슬러', pattern: { groups: [4] }, tip: '현을 건너는 슬러는 활을 원을 그리듯 움직여요.' },
  { id: '8', label: '8음 슬러', pattern: { groups: [8] }, tip: '한 활에 8음. 활을 아껴 처음부터 끝까지 같은 소리로.' },
  { id: '9', label: '16음 슬러', pattern: { groups: [16] }, tip: '아주 느린 템포부터. 활 배분을 4등분해 생각해요.' },
  { id: '10', label: '1 + 3 슬러', pattern: { groups: [1, 3] }, tip: '한 음은 짧고 빠른 활, 세 음 슬러는 같은 길이로 돌아와요.' },
  { id: '11', label: '3 슬러 + 1', pattern: { groups: [3, 1] }, tip: '마지막 한 음에서 활이 튀지 않게 속도를 맞춰요.' },
  { id: '12', label: '1 + 2 슬러 + 1', pattern: { groups: [1, 2, 1] }, tip: '가운데 슬러에서 활을 더 쓰니 활 위치가 조금씩 옮겨가요.' },
  { id: '13', label: '2 슬러 + 1 + 1', pattern: { groups: [2, 1, 1] }, tip: '슬러 음은 활을 천천히, 따로 음은 빠르게.' },
  { id: '14', label: '1 + 1 + 2 슬러', pattern: { groups: [1, 1, 2] }, tip: '박마다 내림·올림이 바뀌어요. 시작 방향을 확인하세요.' },
  { id: '15', label: '7 슬러 + 1', pattern: { groups: [7, 1] }, tip: '7음을 한 활에, 마지막 한 음을 반대 활로 빠르게.' },
  { id: '16', label: '스타카토 (끊어서)', pattern: { groups: [1], stacc: 'all' }, tip: '음마다 활을 멈춰 끊어요. 활 가운데 위쪽에서.' },
  { id: '17', label: '첫 음 강세 (마르텔레)', pattern: { groups: [1], accent: true }, tip: '박의 첫 음을 활을 꽉 물었다가 놓듯이.' },
  { id: '18', label: '2음 슬러 스타카토', pattern: { groups: [2], stacc: 'slurred' }, tip: '한 활 안에서 두 음을 끊어요 (같은 방향으로 멈췄다 가기).' },
  { id: '19', label: '4음 슬러 스타카토', pattern: { groups: [4], stacc: 'slurred' }, tip: '올림활 스타카토부터 연습하면 쉬워요.' },
  { id: '20', label: '1 + 3 슬러 스타카토', pattern: { groups: [1, 3], stacc: 'slurred' }, tip: '첫 음은 길게, 나머지 셋을 한 활에 끊어서.' },
  { id: '21', label: '점리듬 (긴-짧은)', pattern: { groups: [1], rhythm: [9, 3] }, tip: '짧은 음은 활을 적게, 긴 음은 많이. 리듬을 정확하게.' },
  { id: '22', label: '점리듬 2음 슬러', pattern: { groups: [2], rhythm: [9, 3] }, tip: '슬러 안 점리듬은 짧은 음 앞에서 활 속도를 늦춰요.' },
  { id: '23', label: '역점리듬 (짧은-긴)', pattern: { groups: [2], rhythm: [3, 9] }, tip: '짧은 음이 묻히지 않게 또렷하게 시작해요.' },
  { id: '24', label: '점리듬 4음 슬러', pattern: { groups: [4], rhythm: [9, 3] }, tip: '한 활 안에서 리듬만 바꿔요. 왼손 손가락을 정확히.' },
];
export const variantById = (id: string) => BOW_VARIANTS.find((v) => v.id === id) ?? BOW_VARIANTS[0];
export const bowProgressId = (base: BowBaseId, key: string, variant: string) => `bow:${base}:${base === 'open' ? '-' : key}:${variant}`;
