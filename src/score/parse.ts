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
  /** 파트 이름들 (여러 파트 악보) */
  parts: string[];
}
export interface ParseOptions {
  /** 몇 번째 파트 (0부터) */
  part?: number;
  /** 반주용: 모든 성부·화음의 모든 음 */
  allNotes?: boolean;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseMusicXML(xml: string, opt: ParseOptions = {}): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML 파일을 읽을 수 없어요.');
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
  for (const m of Array.from(part.children).filter((c) => c.nodeName === 'measure')) {
    // 못갖춘마디 0 도 그대로 (0 을 거짓으로 보면 1번 마디와 겹침). 번호가 없거나 겹치면 앞 번호 + 1
    const raw = (m.getAttribute('number') ?? '').trim();
    const n0 = raw === '' ? NaN : Number(raw);
    const num = Number.isFinite(n0) && !measures.includes(n0) ? n0 : measures.length ? measures[measures.length - 1] + 1 : 1;
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
      if (voice !== '1' && !all) continue;
      if (el.getElementsByTagName('rest').length) continue;
      const p = el.getElementsByTagName('pitch')[0];
      if (!p) continue;
      const midi = 12 * (Number(text(p, 'octave')) + 1) + STEP[text(p, 'step')] + Number(text(p, 'alter') || '0');
      const ties = Array.from(el.getElementsByTagName('tie')).map((t) => t.getAttribute('type'));
      const tieStop = ties.includes('stop'), tieStart = ties.includes('start');
      if (all) {
        const key = `${voice}:${midi}`;
        const prevT = openTies.get(key);
        if (tieStop && prevT) { prevT.dur += dur; if (!tieStart) openTies.delete(key); continue; }
        const nn: ScoreNote = { measure: num, index: 0, midi, beat: start, dur };
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
        contAt = start;
        tieOpen = tieStart;
        continue;
      }
      if (!isChord) { contAt = null; tieOpen = tieStart; } else if (tieStart) tieOpen = true;
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
  if (all) notes.sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  return { title, measures, notes, measureLen, time, parts };
}

export function notesInRange(s: ParsedScore, from: number, to: number): ScoreNote[] {
  return s.notes.filter((n) => n.measure >= from && n.measure <= to);
}
