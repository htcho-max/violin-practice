/** 계이름·음이름 쓰기: 고정 도(C=도), 이동 도(조의 장조 으뜸음=도, 단조는 라로 시작), 영어 음이름(C D E) */
export type SolfaMode = 'fixed' | 'movable' | 'letter';
const STEPS = 'CDEFGAB';
const SOL = ['도', '레', '미', '파', '솔', '라', '시'];
const SIGN: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** 조표에서 그 글자의 변화표 */
export function keyAlterOf(step: string, fifths: number): number {
  if (fifths > 0) return 'FCGDAEB'.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return 'BEADGCF'.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}
/** 장조 으뜸음 글자 */
const TONIC = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
function tonicStep(fifths: number): string {
  const f = Math.max(-7, Math.min(7, fifths));
  return (f >= 0 ? TONIC[f] : TONIC[7 - f])[0];
}

export function solfaName(step: string | undefined, alter: number, fifths: number, mode: SolfaMode): string {
  if (!step || !STEPS.includes(step)) return '';
  const i = STEPS.indexOf(step);
  if (mode === 'letter') return step + SIGN[alter];
  if (mode === 'fixed') return SOL[i] + SIGN[alter];
  // 이동 도: 조의 으뜸음 글자를 도로. 조표와 다르게 바뀐 음만 ♯·♭ 표시
  const d = (i - STEPS.indexOf(tonicStep(fifths)) + 7) % 7;
  const rel = alter - keyAlterOf(step, fifths);
  return SOL[d] + SIGN[Math.max(-2, Math.min(2, rel))];
}

/** 악보 XML 의 음마다 계이름을 가사(<lyric>)로 붙임 — OSMD 가 오선 아래에 겹치지 않게 그려 줌.
 *  화음은 위 음 하나만, 붙임줄로 이어진 뒤 음은 빼고. 이미 있는 가사는 지움 (계이름을 켰을 때만 쓰임) */
export function withSolfa(xml: string, mode: SolfaMode): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  const child = (el: Element, n: string) => Array.from(el.children).find((c) => c.tagName === n) ?? null;
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let fifths = 0;
    for (const meas of Array.from(part.getElementsByTagName('measure'))) {
      for (const k of Array.from(meas.getElementsByTagName('key'))) { const f = child(k, 'fifths'); if (f) fifths = Number(f.textContent); }
      // 화음은 같은 박에서 가장 높은 음에 (첫 음에 붙이고 더 높은 음이 오면 옮김)
      let chordHead: { el: Element; midi: number } | null = null;
      for (const note of Array.from(meas.getElementsByTagName('note'))) {
        for (const l of Array.from(note.getElementsByTagName('lyric'))) l.remove();
        const p = child(note, 'pitch');
        const isChord = !!child(note, 'chord');
        if (!p || child(note, 'grace')) { if (!isChord) chordHead = null; continue; }
        const step = child(p, 'step')?.textContent?.trim() ?? '';
        const alter = Number(child(p, 'alter')?.textContent ?? '0');
        const oct = Number(child(p, 'octave')?.textContent ?? '4');
        const midi = 12 * (oct + 1) + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[step] + alter;
        const tiedIn = Array.from(note.getElementsByTagName('tie')).some((t) => t.getAttribute('type') === 'stop');
        const text = solfaName(step, alter, fifths, mode);
        const mk = () => {
          const l = doc.createElement('lyric'); l.setAttribute('number', '1');
          const sy = doc.createElement('syllabic'); sy.textContent = 'single';
          const tx = doc.createElement('text'); tx.textContent = text;
          l.append(sy, tx); return l;
        };
        if (isChord && chordHead) {
          if (midi > chordHead.midi && !tiedIn) { for (const l of Array.from(chordHead.el.getElementsByTagName('lyric'))) l.remove(); note.appendChild(mk()); chordHead = { el: note, midi }; }
          continue;
        }
        chordHead = { el: note, midi };
        if (tiedIn || !text) continue;
        note.appendChild(mk());
      }
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
