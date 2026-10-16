import { keyById, type Key } from './theory';
import type { FingerOptions } from './fingering';
import { scale, arpeggio, thirds, seq4, stringScale, shiftDrill, etude, autoRange, type Phrase } from './patterns';
import { build, type Bowing, type FingerShow, type Built } from './build';

export type PatternId = 'scale' | 'arpeggio' | 'thirds' | 'seq4' | 'stringScale' | 'shiftDrill' | 'etude';
export type PositionSet = '1' | '3' | '1-3';
export const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'scale', label: '음계' },
  { id: 'arpeggio', label: '분산화음' },
  { id: 'thirds', label: '3도' },
  { id: 'seq4', label: '4음 시퀀스' },
  { id: 'etude', label: '에튀드' },
  { id: 'stringScale', label: '한 현 음계' },
  { id: 'shiftDrill', label: '포지션 이동 (같은 손가락)' },
];
export const POSITION_SETS: { id: PositionSet; label: string }[] = [
  { id: '1', label: '1포지션' },
  { id: '3', label: '3포지션' },
  { id: '1-3', label: '1 ↔ 3포지션' },
];
export const STRING_NAMES = ['G현', 'D현', 'A현', 'E현'];

export interface ExerciseSpec {
  key: string;
  pattern: PatternId;
  positions: PositionSet;
  octaves?: number;
  string?: number; // 한 현 연습
  perBeat?: number; // 단계가 정한 리듬 (없으면 사용자 선택)
  bowing?: Bowing;
}
export interface Step { id: string; stage: string; title: string; tip: string; spec: ExerciseSpec; tempo: number }

export const STAGES = [
  { id: 'A', title: '1단계 · 1포지션 음계', desc: '4권 곡들의 조성(G·D·A장조, A단조)을 1포지션에서 고르게. 드론을 켜고 해도 좋아요.' },
  { id: 'B', title: '2단계 · 3포지션', desc: '3포지션의 손 모양과 음정을 따로 익혀요. 개방현 없이 연습해요.' },
  { id: 'C', title: '3단계 · 1 ↔ 3포지션 이동', desc: '이동하는 음(채점에서 따로 보여줘요)을 정확히 도착하는 게 목표예요. 자이츠 5번, 비발디 a단조 준비.' },
  { id: 'D', title: '4단계 · 에튀드', desc: '음계와 분산화음을 엮은 8마디 연습곡. "다른 곡 만들기"로 매번 새 곡을 만들 수 있어요.' },
];

export const STEPS: Step[] = [
  { id: 'A1', stage: 'A', title: 'G장조 2옥타브 음계', tip: '3번 손가락 C와 높은 F#의 음정에 주의해요.', spec: { key: 'G', pattern: 'scale', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'A2', stage: 'A', title: 'G장조 분산화음', tip: '현을 건널 때 활 높이를 미리 준비해요.', spec: { key: 'G', pattern: 'arpeggio', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'A3', stage: 'A', title: 'A장조 2옥타브 음계', tip: 'C#·G#는 높은 2·3번 손가락. 개방현과 비교해 보세요.', spec: { key: 'A', pattern: 'scale', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'A4', stage: 'A', title: 'A단조 가락단음계', tip: '올라갈 때 F#·G#, 내려올 때 G·F. 비발디 a단조의 조성이에요.', spec: { key: 'Am', pattern: 'scale', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'A5', stage: 'A', title: 'G장조 3도', tip: '손가락을 미리 내려 두면 3도가 깨끗해요.', spec: { key: 'G', pattern: 'thirds', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'A6', stage: 'A', title: 'D장조 4음 시퀀스', tip: '박의 첫 음에 살짝 무게를 두세요.', spec: { key: 'D', pattern: 'seq4', positions: '1', octaves: 2 }, tempo: 60 },
  { id: 'B1', stage: 'B', title: 'C장조 3포지션 음계', tip: '1번 손가락이 G현에서 C. 엄지는 1번과 마주 보게.', spec: { key: 'C', pattern: 'scale', positions: '3', octaves: 2 }, tempo: 56 },
  { id: 'B2', stage: 'B', title: 'G장조 3포지션 음계', tip: '3포지션의 G장조는 D현 1번 손가락 G에서 시작해요.', spec: { key: 'G', pattern: 'scale', positions: '3', octaves: 1 }, tempo: 56 },
  { id: 'B3', stage: 'B', title: 'C장조 3포지션 분산화음', tip: '손을 움직이지 말고 손가락만 건너가요.', spec: { key: 'C', pattern: 'arpeggio', positions: '3', octaves: 2 }, tempo: 56 },
  { id: 'B4', stage: 'B', title: 'D장조 3포지션 분산화음', tip: 'G현 2번 손가락 D에서 시작해 E현 4번 D까지. 손은 그대로 두고요.', spec: { key: 'D', pattern: 'arpeggio', positions: '3', octaves: 2 }, tempo: 56 },
  { id: 'B5', stage: 'B', title: 'A단조 3포지션 음계', tip: '비발디 a단조에서 쓰는 손 모양이에요.', spec: { key: 'Am', pattern: 'scale', positions: '3', octaves: 1 }, tempo: 56 },
  { id: 'C1', stage: 'C', title: 'A현 1 ↔ 3포지션 같은 손가락 이동', tip: '이동 중에 손가락을 현 위에 가볍게 둔 채 미끄러져요. 2음 슬러로 하면 도착 음을 귀로 확인하기 쉬워요.', spec: { key: 'D', pattern: 'shiftDrill', positions: '1-3', string: 2, perBeat: 1, bowing: 'slur2' }, tempo: 56 },
  { id: 'C2', stage: 'C', title: 'E현 1 ↔ 3포지션 같은 손가락 이동', tip: '팔꿈치를 살짝 안으로 돌리며 올라가요.', spec: { key: 'A', pattern: 'shiftDrill', positions: '1-3', string: 3, perBeat: 1, bowing: 'slur2' }, tempo: 56 },
  { id: 'C3', stage: 'C', title: 'A현 한 현 음계', tip: '개방현부터 3포지션 4번 손가락 G까지 한 현으로.', spec: { key: 'D', pattern: 'stringScale', positions: '1-3', string: 2 }, tempo: 56 },
  { id: 'C4', stage: 'C', title: 'D장조 2옥타브 (위에서 3포지션)', tip: 'E현에서 3포지션으로 올라가 높은 D까지.', spec: { key: 'D', pattern: 'scale', positions: '1-3', octaves: 2 }, tempo: 60 },
  { id: 'C5', stage: 'C', title: 'D장조 3도 (1 ↔ 3)', tip: '올라갈 때 E현 3포지션으로, 내려올 때 1포지션으로 돌아와요.', spec: { key: 'D', pattern: 'thirds', positions: '1-3', octaves: 2 }, tempo: 56 },
  { id: 'D1', stage: 'D', title: 'G장조 에튀드 · 1포지션', tip: '첫 4마디와 뒤 4마디의 음형이 달라요. 음형이 바뀌는 곳에서 활 배분을 다시 생각해요.', spec: { key: 'G', pattern: 'etude', positions: '1' }, tempo: 60 },
  { id: 'D2', stage: 'D', title: 'A단조 에튀드 · 1포지션', tip: 'V화음(E장조)에서 G#가 나와요.', spec: { key: 'Am', pattern: 'etude', positions: '1' }, tempo: 60 },
  { id: 'D3', stage: 'D', title: 'C장조 에튀드 · 3포지션', tip: '처음부터 끝까지 3포지션에 머물러요.', spec: { key: 'C', pattern: 'etude', positions: '3' }, tempo: 56 },
  { id: 'D4', stage: 'D', title: 'D장조 에튀드 · 1 ↔ 3포지션', tip: '5~6마디가 높은 음역이라 포지션을 옮겨요.', spec: { key: 'D', pattern: 'etude', positions: '1-3' }, tempo: 60 },
  { id: 'D5', stage: 'D', title: 'A단조 에튀드 · 1 ↔ 3포지션', tip: '비발디 a단조 1악장을 위한 준비 곡.', spec: { key: 'Am', pattern: 'etude', positions: '1-3' }, tempo: 60 },
];

export function fingerOptions(ps: PositionSet, string?: number): FingerOptions {
  const positions = ps === '1' ? [1] : ps === '3' ? [3] : [1, 3];
  return { positions, allowOpen: ps !== '3', strings: string === undefined ? undefined : [string] };
}

export interface MakeOptions { perBeat: number; bowing: Bowing; fingers: FingerShow; seed: number; title?: string; tempo?: number }
export interface Made extends Built { title: string; describe: string }

export function makeExercise(spec: ExerciseSpec, o: MakeOptions): Made {
  const key: Key = keyById(spec.key);
  const fo = fingerOptions(spec.positions, spec.string);
  const perBeat = spec.perBeat ?? o.perBeat;
  const bowing = spec.bowing ?? o.bowing;
  let phrases: Phrase[];
  let rangeText = '';
  const posLabel = POSITION_SETS.find((p) => p.id === spec.positions)!.label;
  if (spec.pattern === 'stringScale' || spec.pattern === 'shiftDrill') {
    const s = spec.string ?? 2;
    phrases = spec.pattern === 'stringScale' ? stringScale(key, s) : shiftDrill(key, s);
    rangeText = STRING_NAMES[s];
  } else if (spec.pattern === 'etude') {
    const lo = spec.positions === '3' ? 28 : 25;
    const hi = spec.positions === '1' ? 41 : 44;
    const r = autoRange(key, fo, 2);
    phrases = etude(key, { lo: Math.max(lo, (r?.[0] ?? lo) - 0), hi, perBeat: Math.max(2, perBeat), seed: o.seed, fo, highMiddle: spec.positions === '1-3' });
    rangeText = `#${o.seed}`;
  } else {
    const r = autoRange(key, fo, spec.octaves ?? 2);
    if (!r) return { xml: '', notes: [], shiftKeys: [], measures: 0, error: `${key.name}는 ${posLabel}에서 낼 수 없어요.`, title: '', describe: '' };
    const fn = { scale, arpeggio, thirds, seq4 }[spec.pattern];
    phrases = fn(key, r[0], r[1]);
    const oct = Math.round((r[1] - r[0]) / 7);
    rangeText = (r[1] - r[0]) % 7 === 0 ? `${oct}옥타브` : '';
  }
  const patLabel = PATTERNS.find((p) => p.id === spec.pattern)!.label;
  const title = o.title ?? (spec.string !== undefined ? [key.name, rangeText, patLabel, `· ${posLabel}`] : [key.name, patLabel, rangeText, `· ${posLabel}`]).filter(Boolean).join(' ');
  const b = build({ title, key, phrases, perBeat: spec.pattern === 'etude' ? Math.max(2, perBeat) : perBeat, bowing, fo, fingers: o.fingers, tempo: o.tempo });
  return { ...b, title, describe: '' };
}
