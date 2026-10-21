import { type Key, type Pitch, letterOf, octaveOf, keyAlter, pitchName } from './theory';
import { fingerPassage, handPositions, type FingerOptions, type Fingering } from './fingering';
import type { Phrase } from './patterns';

export const DIV = 24; // 4분음표 하나
const MEAS = 96; // 4/4

export type Bowing = 'detache' | 'slur2' | 'slurBeat' | 'slur2Beats' | 'staccato';
export const BOWINGS: { id: Bowing; label: string }[] = [
  { id: 'detache', label: '한 음씩 (데타셰)' },
  { id: 'slur2', label: '2음 슬러' },
  { id: 'slurBeat', label: '한 박 슬러' },
  { id: 'slur2Beats', label: '두 박 슬러' },
  { id: 'staccato', label: '스타카토' },
];
export const RHYTHMS: { perBeat: number; label: string }[] = [
  { perBeat: 1, label: '4분음표' },
  { perBeat: 2, label: '8분음표' },
  { perBeat: 3, label: '셋잇단' },
  { perBeat: 4, label: '16분음표' },
];
export type FingerShow = 'all' | 'shifts' | 'none';

/** 세브치크식 활 변형: 슬러 묶음 크기(반복), 리듬(반복, DIV 단위), 꾸밈 */
export interface BowPattern {
  groups: number[];
  rhythm?: number[];
  stacc?: 'all' | 'slurred';
  accent?: boolean; // 박의 첫 음
  upBow?: boolean; // 올림활로 시작
  words?: string; // 활 쓰는 곳
}

export interface BuildOptions {
  title: string;
  key: Key;
  phrases: Phrase[];
  perBeat: number;
  bowing: Bowing;
  fo: FingerOptions;
  fingers: FingerShow;
  tempo?: number;
  bow?: BowPattern;
}
export interface BuiltNote { p: Pitch | null; dur: number; f: Fingering | null; hand: number; shift: boolean; slur?: 'start' | 'stop'; stacc?: boolean; accent?: boolean; bowMark?: 'up' | 'down'; words?: string }
export interface Built { xml: string; notes: BuiltNote[]; shiftKeys: string[]; measures: number; error?: string }

/** 패턴 → 리듬·활·운지가 붙은 음 목록 */
export function arrange(o: BuildOptions): BuiltNote[] {
  const u = DIV / o.perBeat;
  const flat = o.phrases.flat();
  const fs = fingerPassage(flat.map((n) => n.p), o.fo).map((f, i) => flat[i].force ?? f);
  const hands = handPositions(fs, Math.min(...o.fo.positions));
  const out: BuiltNote[] = [];
  let pos = 0, k = 0;
  const groupLen = o.bowing === 'slur2' ? 2 : o.bowing === 'slurBeat' ? o.perBeat : o.bowing === 'slur2Beats' ? o.perBeat * 2 : 1;
  const bow: BowPattern = o.bow ?? { groups: [groupLen], stacc: o.bowing === 'staccato' ? 'all' : undefined };
  o.phrases.forEach((ph, pi) => {
    const lastPhrase = pi === o.phrases.length - 1;
    const start = out.length;
    ph.forEach((n, j) => {
      let dur = bow.rhythm ? bow.rhythm[j % bow.rhythm.length] : u;
      const isFinal = lastPhrase && j === ph.length - 1;
      const isEnd = j === ph.length - (lastPhrase ? 2 : 1); // 프레이즈 끝 (마침음 앞 음 포함)
      if (isFinal) dur = MEAS - (pos % MEAS); // 마침음은 마디 끝까지 (항상 박 위에서 시작)
      else if (isEnd) dur = (pos + dur) % DIV === 0 ? dur : DIV - (pos % DIV); // 박 끝까지 늘림
      const f = fs[k];
      const shift = k > 0 && hands[k] !== hands[k - 1];
      out.push({ p: n.p, dur, f, hand: hands[k], shift, stacc: bow.stacc === 'all' && !isFinal, accent: bow.accent && pos % DIV === 0 && !isFinal });
      pos += dur; k++;
    });
    // 슬러 묶음 (프레이즈 안에서만, 마침음은 제외)
    {
      const end = lastPhrase ? out.length - 1 : out.length;
      let a = start, g = 0;
      while (a < end) {
        const size = bow.groups[g++ % bow.groups.length];
        const b = Math.min(end, a + size) - 1;
        if (b > a) {
          out[a].slur = 'start'; out[b].slur = 'stop';
          if (bow.stacc === 'slurred') for (let x = a; x <= b; x++) out[x].stacc = true;
        }
        a += size;
      }
    }
  });
  if (out.length) { out[0].bowMark = bow.upBow ? 'up' : o.bow ? 'down' : undefined; out[0].words = bow.words; }
  // 마지막 박이 덜 찼으면 쉼표로 채우기
  while (pos % MEAS !== 0) { const d = pos % DIV ? DIV - (pos % DIV) : DIV; out.push({ p: null, dur: d, f: null, hand: 0, shift: false }); pos += d; }
  return out;
}

const TYPES: Record<number, [string, number, boolean]> = { // dur → [type, dots, triplet]
  3: ['32nd', 0, false], 9: ['16th', 1, false], 4: ['16th', 0, true], 6: ['16th', 0, false], 8: ['eighth', 0, true], 12: ['eighth', 0, false], 16: ['quarter', 0, true],
  18: ['eighth', 1, false], 24: ['quarter', 0, false], 36: ['quarter', 1, false], 48: ['half', 0, false], 72: ['half', 1, false], 96: ['whole', 0, false],
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const POS_NAME: Record<number, string> = { 1: '1포지션', 2: '2포지션', 3: '3포지션', 4: '4포지션', 5: '5포지션' };

export function toMusicXML(o: BuildOptions, notes: BuiltNote[]): Built {
  const measures: string[] = [];
  let cur: string[] = [];
  let pos = 0, idxInMeasure = 0, mnum = 1;
  let acc = new Map<string, number>();
  const shiftKeys: string[] = [];
  const beams = beamPlan(notes);
  let tupletOpen = false;
  let shownHand = -1;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (pos % MEAS === 0) {
      if (cur.length) measures.push(wrapMeasure(mnum++, cur, measures.length === 0, o));
      cur = []; idxInMeasure = 0; acc = new Map();
    }
    const t = TYPES[n.dur];
    if (!t) return { xml: '', notes, shiftKeys, measures: 0, error: `표현할 수 없는 길이 ${n.dur}` };
    const [type, dots, trip] = t;
    // 포지션 표시
    if (n.p && n.f && o.fingers !== 'none' && n.hand !== shownHand && (n.f.pos > 0 || shownHand === -1)) {
      cur.push(`<direction placement="above"><direction-type><words font-size="9">${POS_NAME[n.hand] ?? n.hand + '포지션'}</words></direction-type></direction>`);
      shownHand = n.hand;
    }
    if (n.words) cur.push(`<direction placement="above"><direction-type><words font-size="9" font-style="italic">${esc(n.words)}</words></direction-type></direction>`);
    const x: string[] = ['<note>'];
    if (n.p) {
      const L = letterOf(n.p.d), oct = octaveOf(n.p.d);
      const accKey = `${L}${oct}`;
      const prev = acc.has(accKey) ? acc.get(accKey)! : keyAlter(o.key.fifths, L);
      x.push(`<pitch><step>${L}</step>${n.p.alter ? `<alter>${n.p.alter}</alter>` : ''}<octave>${oct}</octave></pitch>`);
      x.push(`<duration>${n.dur}</duration><voice>1</voice><type>${type}</type>${'<dot/>'.repeat(dots)}`);
      if (prev !== n.p.alter) { x.push(`<accidental>${n.p.alter >= 2 ? 'double-sharp' : n.p.alter > 0 ? 'sharp' : n.p.alter <= -2 ? 'flat-flat' : n.p.alter < 0 ? 'flat' : 'natural'}</accidental>`); acc.set(accKey, n.p.alter); }
    } else {
      x.push(`<rest/><duration>${n.dur}</duration><voice>1</voice><type>${type}</type>${'<dot/>'.repeat(dots)}`);
    }
    if (trip) x.push('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
    beams[i].forEach((b, l) => x.push(`<beam number="${l + 1}">${b}</beam>`));
    const nots: string[] = [];
    if (trip && pos % DIV === 0) { nots.push('<tuplet type="start" bracket="no"/>'); tupletOpen = true; }
    if (trip && tupletOpen && (pos + n.dur) % DIV === 0) { nots.push('<tuplet type="stop"/>'); tupletOpen = false; }
    if (n.slur) nots.push(`<slur type="${n.slur}" number="1"/>`);
    if (n.p && (n.stacc || n.accent)) nots.push(`<articulations>${n.accent ? '<accent/>' : ''}${n.stacc ? '<staccato/>' : ''}</articulations>`);
    if (n.bowMark) nots.push(n.bowMark === 'up' ? '<technical><up-bow/></technical>' : '<technical><down-bow/></technical>');
    const showF = n.p && n.f && (o.fingers === 'all' || (o.fingers === 'shifts' && (n.shift || i === 0)));
    if (showF) nots.push(`<technical><fingering>${n.f!.finger}</fingering></technical>`);
    if (nots.length) x.push(`<notations>${nots.join('')}</notations>`);
    x.push('</note>');
    cur.push(x.join(''));
    if (n.p) { if (n.shift) shiftKeys.push(`${mnum}:${idxInMeasure}`); idxInMeasure++; }
    pos += n.dur;
  }
  if (cur.length) measures.push(wrapMeasure(mnum, cur, measures.length === 0, o));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><work><work-title>${esc(o.title)}</work-title></work>
<identification><creator type="composer">연습곡 생성기</creator></identification>
<part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
<part id="P1">${measures.join('\n')}</part></score-partwise>`;
  return { xml, notes, shiftKeys, measures: measures.length };
}

const LEVEL: Record<string, number> = { eighth: 1, '16th': 2, '32nd': 3 };
/** 박 안에서 8분·16분·32분 음을 빔으로 묶기 (음마다 빔 단계별 상태) */
function beamPlan(notes: BuiltNote[]): string[][] {
  const out: string[][] = notes.map(() => []);
  let pos = 0, group: number[] = [];
  const close = () => {
    if (group.length >= 2) {
      const lv = group.map((g) => LEVEL[TYPES[notes[g].dur][0]]);
      for (let L = 1; L <= 3; L++) {
        let j = 0;
        while (j < group.length) {
          if (lv[j] < L) { j++; continue; }
          let e = j; while (e + 1 < group.length && lv[e + 1] >= L) e++;
          if (e > j) for (let q = j; q <= e; q++) out[group[q]].push(q === j ? 'begin' : q === e ? 'end' : 'continue');
          else if (L > 1) out[group[j]].push(j === 0 ? 'forward hook' : 'backward hook');
          j = e + 1;
        }
      }
    }
    group = [];
  };
  notes.forEach((n, i) => {
    if (pos % DIV === 0) close();
    const t = TYPES[n.dur];
    if (n.p && t && LEVEL[t[0]] && Math.floor(pos / DIV) === Math.floor((pos + n.dur - 1) / DIV)) group.push(i);
    else close();
    pos += n.dur;
  });
  close();
  return out;
}

function wrapMeasure(num: number, body: string[], first: boolean, o: BuildOptions): string {
  const attr = first
    ? `<attributes><divisions>${DIV}</divisions><key><fifths>${o.key.fifths}</fifths><mode>${o.key.mode}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      (o.tempo ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${o.tempo}</per-minute></metronome></direction-type><sound tempo="${o.tempo}"/></direction>` : '')
    : '';
  return `<measure number="${num}">${attr}${body.join('')}</measure>`;
}

export function build(o: BuildOptions): Built {
  const notes = arrange(o);
  return toMusicXML(o, notes);
}
export const describe = (notes: BuiltNote[]) => notes.filter((n) => n.p).map((n) => `${pitchName(n.p!)}${n.f ? `(${n.f.finger}${n.f.pos ? '/' + n.f.pos : ''})` : ''}`).join(' ');
