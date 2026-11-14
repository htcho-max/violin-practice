// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
// @ts-ignore 노드 내장 모듈 (tsconfig 에 node 타입 없음)
import { existsSync } from 'node:fs';
import { instFor, planPlayback } from '../src/score/player';
import { FLUTE_ROWS, chooseFlute, isFluteName } from '../src/audio/fluteSampler';
import { parseMusicXML } from '../src/score/parse';

describe('플루트 반주 소리', () => {
  it('파트 이름으로 악기 고르기', () => {
    for (const n of ['플루트', '플룻', 'Flute', 'Flute 1', 'Fl.', 'Fl', 'Flöte', 'Flauto', 'Piccolo']) expect(instFor(n), n).toBe('flute');
    for (const n of ['피아노', 'Piano', 'Pno.', 'Pf.']) expect(instFor(n), n).toBe('piano');
    for (const n of ['바이올린', 'Violin II', 'Vn.', 'Viola', 'Cello', 'Clarinet', 'Solo']) expect(instFor(n), n).toBe('violin');
    expect(isFluteName('Flugelhorn')).toBe(false);
  });
  it('샘플 파일·음정 보정', () => {
    expect(FLUTE_ROWS.length).toBe(10);
    for (const [name] of FLUTE_ROWS) expect(existsSync(`public/flute/${name}.mp3`), name).toBe(true);
    expect(existsSync('public/flute/NOTICE.txt')).toBe(true);
    const a = chooseFlute(69);
    expect(a.row[0]).toBe('vib-69');
    expect(a.rate).toBeCloseTo(Math.pow(2, 0.8 / 1200), 6); // 샘플이 0.8센트 낮음 → 살짝 빠르게
    expect(chooseFlute(71).row[0]).toBe('vib-72');
    expect(chooseFlute(69, 442).rate).toBeCloseTo(Math.pow(2, (0.8 / 100 + 12 * Math.log2(442 / 440)) / 12), 6);
    expect(chooseFlute(50).row[0]).toBe('vib-60'); // 음역 밖은 가장 가까운 것
  });
  it('반주 계획에 플루트 표시', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list>
<score-part id="P1"><part-name>플루트</part-name></score-part><score-part id="P2"><part-name>바이올린</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
    const mine = parseMusicXML(xml, { part: 1 });
    const fl = parseMusicXML(xml, { part: 0, allNotes: true });
    expect(mine.parts).toEqual(['플루트', '바이올린']);
    const plan = planPlayback(mine, { bpm: 60, from: 1, to: 1, countIn: false }, [{ score: fl, inst: instFor(mine.parts[0]) }]);
    expect(plan.acc.map((e) => [e.inst, e.note.midi])).toEqual([['flute', 81]]);
  });
});
