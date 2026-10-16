/** MusicXML(압축 안 된 .musicxml/.xml) → 마디별 음 목록. 첫 번째 파트, 화음은 가장 높은 음만 */
export interface ScoreNote { measure: number; index: number; midi: number; beat: number; dur: number }
export interface ParsedScore {
  title: string;
  measures: number[];
  notes: ScoreNote[];
  /** 마디 길이 (4분음표 단위). 못갖춘마디는 실제 길이 */
  measureLen: Map<number, number>;
  /** 박자표 [박 수, 음표] (첫 마디 기준) */
  time: [number, number];
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseMusicXML(xml: string): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML 파일을 읽을 수 없어요.');
  const root = doc.documentElement;
  if (root.nodeName !== 'score-partwise') throw new Error('score-partwise 형식의 MusicXML만 지원해요.');
  const text = (el: Element | null | undefined, tag: string) => el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const title = text(root, 'work-title') || text(root, 'movement-title') || '악보';
  const part = root.getElementsByTagName('part')[0];
  if (!part) throw new Error('파트가 없어요.');
  let divisions = 1;
  const notes: ScoreNote[] = [];
  const measures: number[] = [];
  const measureLen = new Map<number, number>();
  let time: [number, number] = [4, 4];
  let nominal = 4;
  for (const m of Array.from(part.children).filter((c) => c.nodeName === 'measure')) {
    const num = Number(m.getAttribute('number')) || measures.length + 1;
    measures.push(num);
    let pos = 0; // 4분음표 단위
    let lastStart = 0;
    let maxPos = 0;
    for (const el of Array.from(m.children)) {
      if (el.nodeName === 'attributes') {
        const d = text(el, 'divisions');
        if (d) divisions = Number(d);
        const b = text(el, 'beats'), bt = text(el, 'beat-type');
        if (b && bt) { if (measures.length === 1) time = [Number(b), Number(bt)]; nominal = (Number(b) * 4) / Number(bt); }
        continue;
      }
      if (el.nodeName === 'backup') { pos -= Number(text(el, 'duration')) / divisions; continue; }
      if (el.nodeName === 'forward') { pos += Number(text(el, 'duration')) / divisions; maxPos = Math.max(maxPos, pos); continue; }
      if (el.nodeName !== 'note') continue;
      if (el.getElementsByTagName('grace').length) continue; // 꾸밈음 제외
      const voice = text(el, 'voice') || '1';
      const isChord = el.getElementsByTagName('chord').length > 0;
      const dur = Number(text(el, 'duration') || '0') / divisions;
      const start = isChord ? lastStart : pos;
      if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
      if (voice !== '1') continue;
      if (el.getElementsByTagName('rest').length) continue;
      const p = el.getElementsByTagName('pitch')[0];
      if (!p) continue;
      const midi = 12 * (Number(text(p, 'octave')) + 1) + STEP[text(p, 'step')] + Number(text(p, 'alter') || '0');
      const prev = notes[notes.length - 1];
      if (isChord && prev && prev.measure === num && prev.beat === start) {
        if (midi > prev.midi) prev.midi = midi; // 화음은 가장 높은 음으로 채점
        continue;
      }
      notes.push({ measure: num, index: 0, midi, beat: start, dur });
    }
    const whole = Array.from(m.getElementsByTagName('rest')).some((r) => r.getAttribute('measure') === 'yes');
    measureLen.set(num, whole || maxPos === 0 ? nominal : m.getAttribute('implicit') === 'yes' ? maxPos : Math.max(maxPos, nominal));
  }
  // 마디 안 순서 번호
  let cur = -1, k = 0;
  for (const n of notes) { if (n.measure !== cur) { cur = n.measure; k = 0; } n.index = k++; }
  return { title, measures, notes, measureLen, time };
}

export function notesInRange(s: ParsedScore, from: number, to: number): ScoreNote[] {
  return s.notes.filter((n) => n.measure >= from && n.measure <= to);
}
