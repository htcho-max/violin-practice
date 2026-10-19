/** 앱에서 악보 음 고치기: MusicXML 안의 음표 하나를 바꿔 새 MusicXML 을 돌려줌.
 *  음 번호(마디:번호)는 parse.ts 의 채점용 음 목록과 같은 기준 (내 파트 1성부, 화음은 가장 높은 음, 붙임줄은 한 음) */
import { parseTracked } from './parse';

export type NoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th';
export type EditOp =
  | { kind: 'shift'; semis: number }
  | { kind: 'dur'; type: NoteType; dot: boolean }
  | { kind: 'rest' };
export type EditResult = { xml: string } | { error: string };

const QUARTERS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = 'FCGDAEB';
const keyAlter = (step: string, fifths: number) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? (SHARP_ORDER.split('').reverse().join('').slice(0, -fifths).includes(step) ? -1 : 0) : 0;

const kid = (el: Element, tag: string) => Array.from(el.children).find((c) => c.nodeName === tag) ?? null;
const txt = (el: Element | null, tag: string) => (el ? kid(el, tag)?.textContent?.trim() ?? '' : '');

function pitchOf(el: Element) {
  const p = kid(el, 'pitch');
  if (!p) return null;
  const step = txt(p, 'step'), octave = Number(txt(p, 'octave')), alter = Number(txt(p, 'alter') || '0');
  return { step, octave, alter, midi: 12 * (octave + 1) + STEP_PC[step] + alter };
}

/** 이 note 앞까지의 조표(fifths)와 divisions */
function contextOf(el: Element): { fifths: number; divisions: number } {
  const measure = el.parentElement!;
  const part = measure.parentElement!;
  let fifths = 0, divisions = 1;
  for (const m of Array.from(part.children)) {
    if (m.nodeName !== 'measure') continue;
    for (const c of Array.from(m.children)) {
      if (m === measure && c === el) return { fifths, divisions };
      if (c.nodeName === 'attributes') {
        const f = c.getElementsByTagName('fifths')[0]?.textContent; if (f) fifths = Number(f);
        const d = c.getElementsByTagName('divisions')[0]?.textContent; if (d) divisions = Number(d);
      }
    }
    if (m === measure) break;
  }
  return { fifths, divisions };
}

/** midi 를 조표에 맞게 적기 (조성 안의 음 우선, 아니면 올릴 땐 #, 내릴 땐 ♭) */
export function spell(midi: number, fifths: number, up: boolean): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const cands: { step: string; alter: number; octave: number; score: number }[] = [];
  for (const step of STEPS) {
    for (const alter of [-1, 0, 1]) {
      if ((((STEP_PC[step] + alter) % 12) + 12) % 12 !== pc) continue;
      const octave = Math.floor((midi - alter - STEP_PC[step]) / 12) - 1;
      const inKey = keyAlter(step, fifths) === alter;
      const score = inKey ? 0 : alter === 0 ? 1 : (up ? alter === 1 : alter === -1) ? 2 : 3;
      cands.push({ step, alter, octave, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  const { step, alter, octave } = cands[0];
  return { step, alter, octave };
}

function setPitch(el: Element, p: { step: string; alter: number; octave: number }, showAcc: boolean, fifths: number) {
  const doc = el.ownerDocument;
  const pe = kid(el, 'pitch')!;
  while (pe.firstChild) pe.removeChild(pe.firstChild);
  const add = (tag: string, v: string) => { const x = doc.createElement(tag); x.textContent = v; pe.appendChild(x); };
  add('step', p.step);
  if (p.alter) add('alter', String(p.alter));
  add('octave', String(p.octave));
  const old = kid(el, 'accidental');
  if (old) el.removeChild(old);
  // 같은 마디 앞에 같은 줄의 다른 임시표가 있거나, 조표와 다르면 임시표를 붙임
  let need = p.alter !== keyAlter(p.step, fifths);
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.nodeName !== 'note') continue;
    const q = pitchOf(s);
    if (q && q.step === p.step && q.octave === p.octave) { need = q.alter !== p.alter; break; }
  }
  if (!showAcc || !need) return;
  const acc = doc.createElement('accidental');
  acc.textContent = { 1: 'sharp', [-1]: 'flat', 0: 'natural' }[p.alter] ?? 'natural';
  // type, dot 뒤에
  const after = Array.from(el.children).filter((c) => ['pitch', 'rest', 'duration', 'tie', 'voice', 'type', 'dot', 'chord', 'grace', 'cue', 'instrument'].includes(c.nodeName)).pop();
  el.insertBefore(acc, after ? after.nextSibling : null);
}

/** 화음이면 그 묶음의 첫 note 와 나머지 */
function chordGroup(el: Element): Element[] {
  let first = el;
  while (kid(first, 'chord')) { const p = first.previousElementSibling; if (!p || p.nodeName !== 'note') break; first = p; }
  const g = [first];
  for (let s = first.nextElementSibling; s && s.nodeName === 'note' && kid(s, 'chord'); s = s.nextElementSibling) g.push(s);
  return g;
}

function makeRest(doc: Document, dur: number, divisions: number, voice: string): Element[] {
  // 길이를 표준 음표 길이로 나누어 쉼표 여러 개로
  const out: Element[] = [];
  let left = dur;
  for (const [type, q] of Object.entries(QUARTERS)) {
    const d = q * divisions;
    if (!Number.isInteger(d) || d <= 0) continue;
    while (left >= d) {
      const n = doc.createElement('note');
      n.appendChild(doc.createElement('rest'));
      const du = doc.createElement('duration'); du.textContent = String(d); n.appendChild(du);
      const v = doc.createElement('voice'); v.textContent = voice; n.appendChild(v);
      const t = doc.createElement('type'); t.textContent = type; n.appendChild(t);
      out.push(n);
      left -= d;
    }
  }
  return left === 0 ? out : [];
}

/** 음 하나 고치기 */
export function editNote(xml: string, measure: number, index: number, op: EditOp, part = 0): EditResult {
  const tr = parseTracked(xml, part);
  const i = tr.notes.findIndex((n) => n.measure === measure && n.index === index);
  if (i < 0) return { error: '그 음을 찾지 못했어요.' };
  const el = tr.els[i];
  const conts = tr.ties[i];
  const { fifths, divisions } = contextOf(el);
  const doc = tr.doc;

  if (op.kind === 'shift') {
    const old = pitchOf(el);
    if (!old) return { error: '음이 아니에요.' };
    const target = old.midi + op.semis;
    if (target < 52 || target > 100) return { error: '바이올린 음역을 벗어나요.' };
    const p = Math.abs(op.semis) === 12 ? { step: old.step, alter: old.alter, octave: old.octave + op.semis / 12 } : spell(target, fifths, op.semis > 0);
    setPitch(el, p, true, fifths);
    // 붙임줄로 이어진 뒤 음들도 같이 (화음이면 같은 높이의 음)
    for (const c of conts) {
      const tone = chordGroup(c).find((x) => pitchOf(x)?.midi === old.midi) ?? c;
      setPitch(tone, p, false, fifths);
    }
  } else if (op.kind === 'rest') {
    for (const head of [el, ...conts]) {
      const g = chordGroup(head);
      const first = g[0];
      for (const x of g.slice(1)) x.parentElement!.removeChild(x);
      const pe = kid(first, 'pitch');
      if (pe) first.replaceChild(doc.createElement('rest'), pe);
      for (const tag of ['accidental', 'tie', 'stem', 'beam', 'notehead']) for (const x of Array.from(first.children).filter((c) => c.nodeName === tag)) first.removeChild(x);
      const nots = kid(first, 'notations');
      if (nots) {
        for (const x of Array.from(nots.children)) if (x.nodeName !== 'slur' && x.nodeName !== 'tuplet') nots.removeChild(x);
        if (!nots.children.length) first.removeChild(nots);
      }
    }
  } else {
    if (conts.length || Array.from(el.getElementsByTagName('tie')).length) return { error: '붙임줄로 이어진 음은 길이를 바꿀 수 없어요.' };
    const g = chordGroup(el);
    const head = g[0];
    if (kid(head, 'time-modification')) return { error: '셋잇단 음은 길이를 바꿀 수 없어요.' };
    const oldDur = Number(txt(head, 'duration'));
    const newDur = QUARTERS[op.type] * (op.dot ? 1.5 : 1) * divisions;
    if (!Number.isInteger(newDur)) return { error: '이 악보에서는 그 길이를 쓸 수 없어요.' };
    const voice = txt(head, 'voice') || '1';
    const parent = head.parentElement!;
    const lastTone = g[g.length - 1];
    const diff = newDur - oldDur;
    if (diff > 0) {
      // 뒤따르는 쉼표를 그만큼 줄임
      const rests: Element[] = [];
      let have = 0;
      for (let s = lastTone.nextElementSibling; s && have < diff; s = s.nextElementSibling) {
        if (s.nodeName === 'backup' || s.nodeName === 'forward') break;
        if (s.nodeName !== 'note') continue;
        if ((txt(s, 'voice') || '1') !== voice) continue;
        if (!kid(s, 'rest')) break;
        rests.push(s); have += Number(txt(s, 'duration'));
      }
      if (have < diff) return { error: '마디 길이가 맞지 않아요. 바로 뒤에 쉼표가 있어야 길게 할 수 있어요.' };
      const leftover = makeRest(doc, have - diff, divisions, voice);
      if (have - diff > 0 && !leftover.length) return { error: '이 길이로는 마디를 맞출 수 없어요.' };
      const anchor = rests[rests.length - 1].nextSibling;
      for (const r of rests) parent.removeChild(r);
      for (const r of leftover) parent.insertBefore(r, anchor);
    } else if (diff < 0) {
      const add = makeRest(doc, -diff, divisions, voice);
      if (!add.length) return { error: '이 길이로는 마디를 맞출 수 없어요.' };
      const anchor = lastTone.nextSibling;
      for (const r of add) parent.insertBefore(r, anchor);
    }
    for (const x of g) {
      kid(x, 'duration')!.textContent = String(newDur);
      for (const d of Array.from(x.children).filter((c) => c.nodeName === 'dot')) x.removeChild(d);
      let t = kid(x, 'type');
      if (!t) { t = doc.createElement('type'); x.insertBefore(t, kid(x, 'voice')?.nextSibling ?? kid(x, 'duration')!.nextSibling); }
      t.textContent = op.type;
      if (op.dot) x.insertBefore(doc.createElement('dot'), t.nextSibling);
      if (QUARTERS[op.type] >= 1) for (const b of Array.from(x.children).filter((c) => c.nodeName === 'beam')) x.removeChild(b);
    }
  }
  return { xml: new XMLSerializer().serializeToString(doc) };
}

/** 한 마디를 원래 악보의 그 마디로 되돌리기 (그 파트) */
export function revertMeasure(xml: string, orig: string, measure: number, part = 0): EditResult {
  const a = parseTracked(xml, part), b = parseTracked(orig, part);
  const ka = a.measures.indexOf(measure), kb = b.measures.indexOf(measure);
  if (ka < 0 || kb < 0) return { error: '그 마디를 찾지 못했어요.' };
  const pa = Math.min(part, a.doc.getElementsByTagName('part').length - 1), pb = Math.min(part, b.doc.getElementsByTagName('part').length - 1);
  const ma = Array.from(a.doc.getElementsByTagName('part')[pa].children).filter((c) => c.nodeName === 'measure')[ka];
  const mb = Array.from(b.doc.getElementsByTagName('part')[pb].children).filter((c) => c.nodeName === 'measure')[kb];
  ma.parentElement!.replaceChild(a.doc.importNode(mb, true), ma);
  return { xml: new XMLSerializer().serializeToString(a.doc) };
}

/** 쉼표로 바꾼 뒤 내 표시 번호 맞추기: 그 마디의 뒤 음 번호를 하나씩 당김 */
export function shiftMarksAfterRest<T>(marks: Record<string, T> | undefined, measure: number, index: number): Record<string, T> | undefined {
  if (!marks) return marks;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(marks)) {
    const [m, i] = k.split(':').map(Number);
    if (m !== measure || i < index) out[k] = v;
    else if (i > index) out[`${m}:${i - 1}`] = v;
  }
  return out;
}
