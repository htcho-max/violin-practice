/** MusicXML(압축 안 된 .musicxml/.xml) → 마디별 음 목록. 첫 번째 파트, 화음은 가장 높은 음만 */
/** 연주법: 재생할 때 소리 길이·어택을 다르게 (있을 때만 true) */
export interface Articulation {
  /** 스타카토(점) — 짧게 */
  stacc?: boolean;
  /** 악센트 — 세게 */
  accent?: boolean;
  /** 테누토 — 끝까지 */
  tenuto?: boolean;
  /** 다음 음과 이음줄로 이어짐 (활을 바꾸지 않음) */
  slurNext?: boolean;
  /** 앞 음에서 이음줄로 이어져 들어옴 (새로 긋지 않음) */
  slurIn?: boolean;
  /** 피치카토 */
  pizz?: boolean;
  /** 활 표시 (∏ 내림활 / V 올림활) */
  bow?: 'up' | 'down';
  /** 셈여림 세기 (mf = 0.78). 악보에 셈여림 표시가 있을 때만 */
  vel?: number;
  /** 늘임표 (재생 때만 길게) */
  fermata?: boolean;
  /** 꾸밈 (트릴·모르덴트·턴) — 재생 때만. upper/lower 는 조성 안의 위·아래 이웃음 */
  orn?: { kind: 'trill' | 'mordent' | 'invmordent' | 'turn'; upper: number; lower: number };
  /** 앞에 붙은 꾸밈음 (재생 때만, 채점 안 함) */
  grace?: number[];
}
export interface ScoreNote { measure: number; index: number; midi: number; beat: number; dur: number; art?: Articulation }
export interface ParsedScore {
  title: string;
  measures: number[];
  notes: ScoreNote[];
  /** 마디 길이 (4분음표 단위). 못갖춘마디는 실제 길이 */
  measureLen: Map<number, number>;
  /** 박자표 [박 수, 음표] (첫 마디 기준) */
  time: [number, number];
  /** 파트 이름들 (여러 파트 악보) */
  parts: string[];
  /** 셈여림·꺾쇠 표시 (위치는 곡 처음부터 4분음표 단위) */
  dyn: DynEvent[];
  /** 마디가 시작하는 위치 (4분음표 단위) */
  measureStart: Map<number, number>;
}
export interface ParseOptions {
  /** 몇 번째 파트 (0부터) */
  part?: number;
  /** 반주용: 모든 성부·화음의 모든 음 */
  allNotes?: boolean;
  /** 음 고치기용: 음마다 MusicXML 요소를 함께 돌려줌 (그 파트 1성부) */
  track?: boolean;
}
/** track 결과: notes[i] 를 만든 note 요소, 붙임줄로 이어진 뒤 요소들 */
export interface TrackedScore extends ParsedScore { doc: Document; els: Element[]; ties: Element[][] }

import { velocities, type DynEvent, type UserMarks } from './dynamics';

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 조표(fifths)의 장음계 음 높이 모음 */
function scalePcs(fifths: number): Set<number> {
  const tonic = (((7 * fifths) % 12) + 12) % 12;
  return new Set([0, 2, 4, 5, 7, 9, 11].map((x) => (x + tonic) % 12));
}
function neighbors(midi: number, fifths: number) {
  const sc = scalePcs(fifths);
  let up = midi + 1; while (!sc.has(up % 12) && up < midi + 3) up++;
  let lo = midi - 1; while (!sc.has(((lo % 12) + 12) % 12) && lo > midi - 3) lo--;
  return { upper: up, lower: lo };
}

export function parseMusicXML(xml: string, opt: ParseOptions = {}): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML 파일을 읽을 수 없어요.');
  return parseDoc(doc, opt);
}
/** 음 고치기용: 음마다 요소를 함께 */
export function parseTracked(xml: string, part = 0): TrackedScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML 파일을 읽을 수 없어요.');
  return parseDoc(doc, { track: true, part }) as TrackedScore;
}

function parseDoc(doc: Document, opt: ParseOptions): ParsedScore {
  const root = doc.documentElement;
  if (root.nodeName !== 'score-partwise') throw new Error('score-partwise 형식의 MusicXML만 지원해요.');
  const text = (el: Element | null | undefined, tag: string) => el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const title = text(root, 'work-title') || text(root, 'movement-title') || '악보';
  const partEls = Array.from(root.getElementsByTagName('part'));
  const names = new Map(Array.from(root.getElementsByTagName('score-part')).map((sp) => [sp.getAttribute('id'), text(sp, 'part-name')]));
  const parts = partEls.map((p, i) => names.get(p.getAttribute('id')) || `파트 ${i + 1}`);
  const part = partEls[Math.min(opt.part ?? 0, partEls.length - 1)];
  if (!part) throw new Error('파트가 없어요.');
  const all = !!opt.allNotes;
  const track = !!opt.track && !all;
  const els: Element[] = [];
  const tieEls: Element[][] = [];
  let fifths = 0;
  let pendingGrace: number[] = [];
  const midiOf = (p: Element) => 12 * (Number(text(p, 'octave')) + 1) + STEP[text(p, 'step')] + Number(text(p, 'alter') || '0');
  // 붙임줄: 앞 음이 tie start 이고 이번 음이 tie stop 이면 앞 음을 늘림
  let tieOpen = false;
  let contAt: number | null = null; // 이어지는 음(화음 포함)의 시작 위치
  const openTies = new Map<string, ScoreNote>(); // 반주용: "성부:midi" → 이어질 음
  let divisions = 1;
  const notes: ScoreNote[] = [];
  const measures: number[] = [];
  const measureLen = new Map<number, number>();
  let time: [number, number] = [4, 4];
  let nominal = 4;
  // 연주법 상태: 이음줄이 열려 있는지(성부별), 피치카토 구간인지
  const slurOpen = new Map<string, number>();
  let pizz = false;
  const dyn: DynEvent[] = [];
  const measureStart = new Map<number, number>();
  let mStart = 0;
  const artOf = (el: Element, voice: string, chordTone: boolean): Articulation | undefined => {
    const has = (tag: string) => el.getElementsByTagName(tag).length > 0;
    const a: Articulation = {};
    if (has('staccato') || has('staccatissimo') || has('spiccato')) a.stacc = true;
    if (has('detached-legato')) { a.stacc = true; a.tenuto = true; }
    if (has('accent') || has('strong-accent')) a.accent = true;
    if (has('tenuto')) a.tenuto = true;
    if (pizz || has('pizzicato')) a.pizz = true;
    if (has('down-bow')) a.bow = 'down'; else if (has('up-bow')) a.bow = 'up';
    if (has('fermata')) a.fermata = true;
    const kind = has('trill-mark') ? 'trill' : has('inverted-mordent') ? 'invmordent' : has('mordent') ? 'mordent' : has('turn') ? 'turn' : null;
    const p = el.getElementsByTagName('pitch')[0];
    if (kind && p) a.orn = { kind, ...neighbors(midiOf(p), fifths) };
    if (!chordTone) {
      const open = slurOpen.get(voice) ?? 0;
      if (open > 0) a.slurIn = true;
      let n = open;
      for (const sl of Array.from(el.getElementsByTagName('slur'))) {
        const t = sl.getAttribute('type');
        if (t === 'stop') n = Math.max(0, n - 1);
      }
      for (const sl of Array.from(el.getElementsByTagName('slur'))) if (sl.getAttribute('type') === 'start') n++;
      slurOpen.set(voice, n);
      if (n > 0) a.slurNext = true;
    }
    return Object.keys(a).length ? a : undefined;
  };
  for (const m of Array.from(part.children).filter((c) => c.nodeName === 'measure')) {
    // 못갖춘마디 0 도 그대로 (0 을 거짓으로 보면 1번 마디와 겹침). 번호가 없거나 겹치면 앞 번호 + 1
    const raw = (m.getAttribute('number') ?? '').trim();
    const n0 = raw === '' ? NaN : Number(raw);
    const num = Number.isFinite(n0) && !measures.includes(n0) ? n0 : measures.length ? measures[measures.length - 1] + 1 : 1;
    measures.push(num);
    measureStart.set(num, mStart);
    let pos = 0; // 4분음표 단위
    let lastStart = 0;
    let maxPos = 0;
    for (const el of Array.from(m.children)) {
      if (el.nodeName === 'attributes') {
        const d = text(el, 'divisions');
        if (d) divisions = Number(d);
        const f = text(el, 'fifths');
        if (f) fifths = Number(f);
        const b = text(el, 'beats'), bt = text(el, 'beat-type');
        if (b && bt) { if (measures.length === 1) time = [Number(b), Number(bt)]; nominal = (Number(b) * 4) / Number(bt); }
        continue;
      }
      if (el.nodeName === 'direction') {
        const w = Array.from(el.getElementsByTagName('words')).map((x) => x.textContent ?? '').join(' ');
        if (/arco/i.test(w)) pizz = false; else if (/pizz/i.test(w)) pizz = true;
        const at = mStart + pos;
        if (/(de)?cresc|dim/i.test(w)) dyn.push({ pos: at, kind: 'words', type: /cresc/i.test(w) && !/decresc/i.test(w) ? 'cresc' : 'dim' });
        for (const d of Array.from(el.getElementsByTagName('dynamics'))) {
          const v = d.firstElementChild?.nodeName;
          if (v) dyn.push({ pos: at, kind: 'dyn', value: v });
        }
        for (const w2 of Array.from(el.getElementsByTagName('wedge'))) {
          const t = w2.getAttribute('type');
          if (t === 'crescendo') dyn.push({ pos: at, kind: 'wedge', type: 'cresc' });
          else if (t === 'diminuendo') dyn.push({ pos: at, kind: 'wedge', type: 'dim' });
          else if (t === 'stop') dyn.push({ pos: at, kind: 'wedge', type: 'stop' });
        }
        continue;
      }
      if (el.nodeName === 'backup') { pos -= Number(text(el, 'duration')) / divisions; continue; }
      if (el.nodeName === 'forward') { pos += Number(text(el, 'duration')) / divisions; maxPos = Math.max(maxPos, pos); continue; }
      if (el.nodeName !== 'note') continue;
      const voice = text(el, 'voice') || '1';
      if (el.getElementsByTagName('grace').length) {
        // 꾸밈음: 채점에서는 빼고, 다음 음 앞에서 짧게 재생
        const gp = el.getElementsByTagName('pitch')[0];
        if (gp && (all || voice === '1') && !el.getElementsByTagName('chord').length) pendingGrace.push(midiOf(gp));
        continue;
      }
      const isChord = el.getElementsByTagName('chord').length > 0;
      const dur = Number(text(el, 'duration') || '0') / divisions;
      const start = isChord ? lastStart : pos;
      if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
      if (voice !== '1' && !all) continue;
      if (el.getElementsByTagName('rest').length) continue;
      const p = el.getElementsByTagName('pitch')[0];
      if (!p) continue;
      const midi = midiOf(p);
      let art = artOf(el, voice, isChord);
      if (pendingGrace.length && !isChord) { art = { ...art, grace: pendingGrace }; pendingGrace = []; }
      const ties = Array.from(el.getElementsByTagName('tie')).map((t) => t.getAttribute('type'));
      const tieStop = ties.includes('stop'), tieStart = ties.includes('start');
      if (all) {
        const key = `${voice}:${midi}`;
        const prevT = openTies.get(key);
        if (tieStop && prevT) { prevT.dur += dur; if (!tieStart) openTies.delete(key); continue; }
        const nn: ScoreNote = { measure: num, index: 0, midi, beat: start, dur, ...(art ? { art } : {}) };
        notes.push(nn);
        if (tieStart) openTies.set(key, nn);
        continue;
      }
      const prev = notes[notes.length - 1];
      // 붙임줄로 이어지는 음: 앞 음 길이에 더하고 따로 세지 않음
      if (isChord && contAt === start) continue;
      // 화음이면 모든 음이 붙임줄로 이어질 때만 (OSMD 그림과 같은 기준)
      const groupStop = () => {
        let ok = tieStop;
        for (let sib = el.nextElementSibling; ok && sib && sib.nodeName === 'note' && sib.getElementsByTagName('chord').length; sib = sib.nextElementSibling) {
          if (!Array.from(sib.getElementsByTagName('tie')).some((t) => t.getAttribute('type') === 'stop')) ok = false;
        }
        return ok;
      };
      if (!isChord && tieOpen && prev && groupStop()) {
        prev.dur += dur;
        if (track) tieEls[tieEls.length - 1].push(el);
        // 붙임줄로 이어진 뒤 음의 이음줄 정보는 합친 음이 이어받음
        if (art?.slurNext) prev.art = { ...prev.art, slurNext: true }; else if (prev.art?.slurNext && !art?.slurNext) prev.art = { ...prev.art, slurNext: undefined };
        contAt = start;
        tieOpen = tieStart;
        continue;
      }
      if (!isChord) { contAt = null; tieOpen = tieStart; } else if (tieStart) tieOpen = true;
      if (isChord && prev && prev.measure === num && prev.beat === start) {
        if (midi > prev.midi) { prev.midi = midi; if (track) els[els.length - 1] = el; } // 화음은 가장 높은 음으로 채점
        continue;
      }
      notes.push({ measure: num, index: 0, midi, beat: start, dur, ...(art ? { art } : {}) });
      if (track) { els.push(el); tieEls.push([]); }
    }
    const whole = Array.from(m.getElementsByTagName('rest')).some((r) => r.getAttribute('measure') === 'yes');
    measureLen.set(num, whole || maxPos === 0 ? nominal : m.getAttribute('implicit') === 'yes' ? maxPos : Math.max(maxPos, nominal));
    mStart += measureLen.get(num)!;
  }
  // 마디 안 순서 번호
  let cur = -1, k = 0;
  for (const n of notes) { if (n.measure !== cur) { cur = n.measure; k = 0; } n.index = k++; }
  if (all) notes.sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  setVelocities(notes, dyn, measureStart);
  const res: ParsedScore = { title, measures, notes, measureLen, time, parts, dyn, measureStart };
  return track ? ({ ...res, doc, els, ties: tieEls } as TrackedScore) : res;
}

/** 셈여림 표시로 음마다 세기(art.vel) 채우기. 표시가 없으면 vel 을 지움 */
function setVelocities(notes: ScoreNote[], dyn: DynEvent[], measureStart: Map<number, number>) {
  const v = velocities(notes.map((n) => (measureStart.get(n.measure) ?? 0) + n.beat), dyn);
  notes.forEach((n, i) => {
    if (v) n.art = { ...n.art, vel: Math.round(v[i] * 1000) / 1000 };
    else if (n.art?.vel !== undefined) { const { vel: _v, ...rest } = n.art; n.art = Object.keys(rest).length ? rest : undefined; }
  });
}

/** 내가 붙인 표시(활·셈여림·꺾쇠)를 악보에 합침. 활은 내 표시가 우선, 셈여림은 악보 표시와 함께 다시 계산 */
export function applyUserMarks(s: ParsedScore, marks: UserMarks | undefined): ParsedScore {
  if (!marks || !Object.keys(marks).length) return s;
  const notes = s.notes.map((n) => ({ ...n, art: n.art ? { ...n.art } : undefined }));
  const extra: DynEvent[] = [];
  for (const n of notes) {
    const m = marks[`${n.measure}:${n.index}`];
    if (!m) continue;
    const at = (s.measureStart.get(n.measure) ?? 0) + n.beat;
    if (m.bow) n.art = { ...n.art, bow: m.bow };
    if (m.dyn) extra.push({ pos: at, kind: 'dyn', value: m.dyn });
    if (m.hair === 'cresc' || m.hair === 'dim') extra.push({ pos: at, kind: 'wedge', type: m.hair });
    if (m.hair === 'end') extra.push({ pos: at + n.dur, kind: 'wedge', type: 'stop' });
  }
  const dyn = [...s.dyn, ...extra];
  setVelocities(notes, dyn, s.measureStart);
  return { ...s, notes, dyn };
}

export function notesInRange(s: ParsedScore, from: number, to: number): ScoreNote[] {
  return s.notes.filter((n) => n.measure >= from && n.measure <= to);
}
