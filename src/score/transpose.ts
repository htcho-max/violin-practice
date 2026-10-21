/**
 * MusicXML 조 옮김: 반음 수만큼 모든 음을 옮기고, 조표도 새 조로 바꾼다.
 * 음 이름은 조표 기준으로 다시 적는다 (원래 조에서 F#5 → 2반음 위 G#5, 조표 D→E).
 * 임시표(<accidental>)는 마디 안에서 새로 계산해 붙인다 (옛 임시표는 지움).
 */
import type { ScoreFile } from '../data/db';
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 조표(샵+/플랫-) → 장조 으뜸음 (글자 순번, 반음) */
function tonicOf(fifths: number): { letter: number; pc: number } {
  // 장조 으뜸음: 0=C, 1=G, 2=D … -1=F, -2=Bb …
  const names = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const n = names[Math.max(-7, Math.min(7, fifths)) + 7];
  const letter = STEPS.indexOf(n[0]);
  const alter = n.length > 1 ? (n[1] === '#' ? 1 : -1) : 0;
  return { letter, pc: (STEP_PC[n[0]] + alter + 12) % 12 };
}

/** s 반음 옮겼을 때 새 조표: 조표 개수가 적은 쪽, 6개면 원래 방향(올리면 샵) */
export function newFifths(fifths: number, semis: number): number {
  const target = (((tonicOf(fifths).pc + semis) % 12) + 12) % 12;
  const cands: number[] = [];
  for (let f = -7; f <= 7; f++) if (tonicOf(f).pc === target) cands.push(f);
  cands.sort((a, b) => Math.abs(a) - Math.abs(b) || (semis >= 0 ? b - a : a - b));
  return cands[0];
}

function keyAlter(fifths: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (fifths > 0) for (const s of 'FCGDAEB'.slice(0, fifths)) out[s] = 1;
  if (fifths < 0) for (const s of 'BEADGCF'.slice(0, -fifths)) out[s] = -1;
  return out;
}

const ACC: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.tagName === name) ?? null;

/** 조 이름 (장조 기준, 단조 표시면 단조 이름) */
export function keyName(fifths: number, mode: string | null = null): string {
  const maj = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const min = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
  const i = Math.max(-7, Math.min(7, fifths)) + 7;
  return mode === 'minor' ? `${min[i]}단조` : `${maj[i]}장조`;
}

/** 첫 조표와 조 이름 */
export function firstKey(xml: string): { fifths: number; mode: string | null } {
  const m = xml.match(/<key>[\s\S]*?<fifths>(-?\d+)<\/fifths>(?:[\s\S]*?<mode>(\w+)<\/mode>)?[\s\S]*?<\/key>/);
  return m ? { fifths: Number(m[1]), mode: m[2] ?? null } : { fifths: 0, mode: null };
}

export function transposeXml(xml: string, semis: number): string {
  if (!semis) return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let oldF = 0, newF = newFifths(0, semis), letterShift = 0;
    const setKey = (f: number) => {
      oldF = f; newF = newFifths(f, semis);
      letterShift = (tonicOf(newF).letter - tonicOf(oldF).letter + 7) % 7;
      // 반음이 많이 바뀌면 (예: +11 → 글자 +6) 글자도 그만큼
    };
    setKey(0);
    let seenKey = false;
    for (const meas of Array.from(part.getElementsByTagName('measure'))) {
      const state = new Map<string, number>(); // "D5" → 이 마디에서 지금 적용되는 변화표
      let ka = keyAlter(newF);
      for (const el of Array.from(meas.children)) {
        if (el.tagName === 'attributes') {
          for (const k of Array.from(el.getElementsByTagName('key'))) {
            const fe = child(k, 'fifths');
            if (!fe) continue;
            setKey(Number(fe.textContent));
            seenKey = true;
            fe.textContent = String(newF);
            ka = keyAlter(newF); state.clear();
          }
          continue;
        }
        if (el.tagName !== 'note') continue;
        const p = child(el, 'pitch');
        if (!p) continue;
        const st = child(p, 'step'), oc = child(p, 'octave'), al = child(p, 'alter');
        if (!st || !oc) continue;
        const step = st.textContent!.trim(), oct = Number(oc.textContent), alt = al ? Number(al.textContent) : 0;
        const midi = 12 * (oct + 1) + STEP_PC[step] + alt + semis;
        // 글자 옮기기: 반음 방향에 맞춰 옥타브 넘김
        const li = STEPS.indexOf(step);
        let shift = letterShift;
        // 위로 옮기면 글자도 위로(0~6), 아래로 옮기면 아래로
        if (semis < 0 && shift > 0) shift -= 7;
        // 큰 이동(옥타브 넘게)
        shift += 7 * Math.trunc(semis / 12);
        const nl = li + shift;
        const nStep = STEPS[((nl % 7) + 7) % 7];
        const nOct = oct + Math.floor(nl / 7);
        let nAlt = midi - (12 * (nOct + 1) + STEP_PC[nStep]);
        // 겹올림·겹내림이 셋 이상 되면 (드문 경우) 가까운 글자로
        if (Math.abs(nAlt) > 2) nAlt = Math.sign(nAlt) * 2;
        st.textContent = nStep; oc.textContent = String(nOct);
        if (nAlt) { if (al) al.textContent = String(nAlt); else { const a = doc.createElement('alter'); a.textContent = String(nAlt); p.insertBefore(a, oc); } }
        else if (al) al.remove();
        // 임시표 다시 계산 (붙임줄로 이어진 음은 표시 안 함)
        const old = child(el, 'accidental'); if (old) old.remove();
        const tiedIn = Array.from(el.getElementsByTagName('tie')).some((t) => t.getAttribute('type') === 'stop');
        const k = `${nStep}${nOct}`;
        const cur = state.has(k) ? state.get(k)! : (ka[nStep] ?? 0);
        if (nAlt !== cur && !tiedIn) {
          const a = doc.createElement('accidental'); a.textContent = ACC[nAlt];
          // MusicXML 순서: … type, dot, accidental, time-modification, stem …
          const after = ['time-modification', 'stem', 'notehead', 'staff', 'beam', 'notations', 'lyric'].map((n) => child(el, n)).find(Boolean);
          el.insertBefore(a, after ?? null);
        }
        state.set(k, nAlt);
      }
      void seenKey;
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

/** 옮긴 뒤 바이올린 최저음(G3)보다 낮은 음 수 */
export function belowViolin(midis: number[]): number { return midis.filter((m) => m < 55).length; }

export const semisLabel = (s: number) => (s === 0 ? '원래 조' : `${s > 0 ? '높게' : '낮게'} ${Math.abs(s)}반음`);

/** 조 옮겨 저장할 악보 제목: "제목 (E장조)", 옥타브만 옮기면 "제목 (D장조 한 옥타브 위)" */
export function transposedTitle(title: string, key: { fifths: number; mode: string | null }, semis: number): string {
  const name = keyName(newFifths(key.fifths, semis), key.mode);
  const oct = semis % 12 === 0 ? ` ${Math.abs(semis / 12) === 1 ? '한' : Math.abs(semis / 12)} 옥타브 ${semis > 0 ? '위' : '아래'}` : '';
  return `${title} (${name}${oct})`;
}
/** 조 옮긴 악보를 새 악보로: 같은 곡·폴더·파트, 내 표시는 복사, 조 옮김·고치기 전 악보·기록은 없이 */
export function transposedCopy(score: ScoreFile, o: { xml: string; accXml?: string; title: string; from?: number; to?: number }): ScoreFile {
  return {
    title: o.title,
    xml: o.xml,
    createdAt: Date.now(),
    ...(score.pieceId ? { pieceId: score.pieceId } : {}),
    ...(score.folder ? { folder: score.folder } : {}),
    ...(score.part !== undefined ? { part: score.part } : {}),
    ...(score.showOthers ? { showOthers: true } : {}),
    ...(o.accXml ? { accXml: o.accXml, ...(score.accName ? { accName: score.accName } : {}) } : {}),
    ...(score.marks && Object.keys(score.marks).length ? { marks: JSON.parse(JSON.stringify(score.marks)) } : {}),
    ...(o.from !== undefined ? { lastFrom: o.from } : {}),
    ...(o.to !== undefined ? { lastTo: o.to } : {}),
  };
}
