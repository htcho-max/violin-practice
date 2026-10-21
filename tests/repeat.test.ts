// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { parseMusicXML, playOrder, hasRepeats, applyUserMarks } from '../src/score/parse';
import { planPlayback } from '../src/score/player';
import { transposeXml, transposedTitle, transposedCopy, firstKey } from '../src/score/transpose';
import { appFullscreen, fullscreenPref, setFullscreenPref, fsUsable } from '../src/state/fullscreen';
import type { ScoreFile } from '../src/data/db';

const m = (num: number, bar = '', extra = '', note = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>') =>
  `<measure number="${num}">${num === 1 ? '<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>' : ''}${bar}${note}${extra}</measure>`;
const doc = (ms: string, more = '') => `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Violin</part-name></score-part>${more ? '<score-part id="P2"><part-name>Piano</part-name></score-part>' : ''}</part-list><part id="P1">${ms}</part>${more}</score-partwise>`;
const fwd = '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>';
const back = (times = '') => `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"${times}/></barline>`;

describe('도돌이표 펼치기', () => {
  it('도돌이표 없으면 그대로 (bars 비어 있음)', () => {
    const s = parseMusicXML(doc(m(1) + m(2)));
    expect(s.bars).toEqual([]);
    expect(hasRepeats(s)).toBe(false);
    expect(playOrder(s)).toEqual([1, 2]);
  });
  it('처음부터 반복, 중간부터 반복, 세 번 반복', () => {
    expect(playOrder(parseMusicXML(doc(m(1) + m(2, '', back()) + m(3))))).toEqual([1, 2, 1, 2, 3]);
    expect(playOrder(parseMusicXML(doc(m(1) + m(2, fwd) + m(3, '', back()) + m(4))))).toEqual([1, 2, 3, 2, 3, 4]);
    expect(playOrder(parseMusicXML(doc(m(1, fwd) + m(2, '', back(' times="3"')))))).toEqual([1, 2, 1, 2, 1, 2]);
  });
  it('1·2번 괄호', () => {
    const e1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const e1end = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
    const e2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const e2end = '<barline location="right"><ending number="2" type="discontinue"/></barline>';
    const s = parseMusicXML(doc(m(1, fwd) + m(2) + m(3, e1) + m(4, '', e1end) + m(5, e2, e2end) + m(6)));
    expect(s.bars.find((b) => b.num === 4)?.ending).toEqual([1]);
    expect(s.bars.find((b) => b.num === 6)?.ending).toBeUndefined();
    expect(playOrder(s)).toEqual([1, 2, 3, 4, 1, 2, 5, 6]);
  });
  it('바이올린 쪽 정보(손가락·하모닉스·마디 시작 위치)는 그대로', () => {
    const fn = '<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><notations><technical><fingering>0</fingering><harmonic/></technical></notations></note>';
    const s = parseMusicXML(doc(m(1, '', '', fn) + m(2, '', back()) + m(3)));
    expect(s.notes[0].art?.finger).toBe(0);
    expect(s.notes[0].art?.harm).toBe(true);
    expect([...s.measureStart.values()]).toEqual([0, 2, 4]);
    expect(hasRepeats(s)).toBe(true);
    // 내 표시를 합쳐도 도돌이표 정보 유지
    expect(applyUserMarks(s, { '1:0': { bow: 'down' } }).bars).toBe(s.bars);
  });
  it('재생 계획: 펼친 순서로, 시간이 이어짐 (반주도 같은 순서)', () => {
    const acc = '<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice></note></measure><measure number="2"><note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice></note></measure><measure number="3"><note><pitch><step>F</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice></note></measure></part>';
    const xml = doc(m(1) + m(2, '', back()) + m(3), acc);
    const s = parseMusicXML(xml);
    const a = parseMusicXML(xml, { part: 1, allNotes: true });
    const p = planPlayback(s, { bpm: 60, from: 1, to: 3, countIn: false, order: playOrder(s) }, [{ score: a, inst: 'piano' }]);
    expect(p.events.map((e) => e.note.measure)).toEqual([1, 2, 1, 2, 3]);
    expect(p.events.map((e) => e.time)).toEqual([0, 2, 4, 6, 8]);
    expect(p.total).toBe(10);
    expect(p.acc.map((e) => [e.note.measure, e.time])).toEqual([[1, 0], [2, 2], [1, 4], [2, 6], [3, 8]]);
    expect(p.clicks.length).toBe(10);
    // 구간 안에서만 반복
    const q = planPlayback(s, { bpm: 60, from: 2, to: 3, countIn: false, order: playOrder(s) });
    expect(q.events.map((e) => e.note.measure)).toEqual([2, 2, 3]);
    // order 없으면 악보 순서 그대로 (채점·지금까지와 같음)
    expect(planPlayback(s, { bpm: 60, from: 1, to: 3, countIn: false }).events.map((e) => e.note.measure)).toEqual([1, 2, 3]);
  });
  it('조 옮겨도 도돌이표는 그대로', () => {
    const xml = doc(m(1) + m(2, '', back()) + m(3));
    expect(playOrder(parseMusicXML(transposeXml(xml, 2)))).toEqual([1, 2, 1, 2, 3]);
  });
});

describe('조 옮긴 악보 새로 저장', () => {
  const xml = doc(m(1) + m(2));
  const base: ScoreFile = {
    id: 7, title: '미뉴에트', xml, createdAt: 1, pieceId: 'p1', folder: 'f1', part: 0, transpose: 2, origXml: '<old/>',
    accXml: xml, accName: '피아노', marks: { '1:0': { bow: 'down', dyn: 'p' } }, lastFrom: 1, lastTo: 2, showOthers: true,
  };
  it('제목 뒤에 조 이름', () => {
    expect(transposedTitle('미뉴에트', firstKey(xml), 2)).toBe('미뉴에트 (E장조)');
    expect(transposedTitle('미뉴에트', firstKey(xml), -2)).toBe('미뉴에트 (C장조)');
    expect(transposedTitle('미뉴에트', { fifths: 0, mode: 'minor' }, 2)).toBe('미뉴에트 (B단조)');
    expect(transposedTitle('미뉴에트', firstKey(xml), 12)).toBe('미뉴에트 (D장조 한 옥타브 위)');
    expect(transposedTitle('미뉴에트', firstKey(xml), -12)).toBe('미뉴에트 (D장조 한 옥타브 아래)');
  });
  it('옮긴 XML · 같은 폴더·곡·파트 · 내 표시 복사 · 조 옮김·고치기 전 악보 없음', () => {
    const t = transposeXml(xml, 2), ta = transposeXml(xml, 2);
    const c = transposedCopy(base, { xml: t, accXml: ta, title: '미뉴에트 (E장조)', from: 1, to: 2 });
    expect(c.id).toBeUndefined();
    expect(c.xml).toBe(t);
    expect(c.accXml).toBe(ta);
    expect(c.accName).toBe('피아노');
    expect(c).toMatchObject({ title: '미뉴에트 (E장조)', pieceId: 'p1', folder: 'f1', part: 0, showOthers: true, lastFrom: 1, lastTo: 2 });
    expect(c.transpose).toBeUndefined();
    expect(c.origXml).toBeUndefined();
    expect(c.marks).toEqual(base.marks);
    expect(c.marks).not.toBe(base.marks); // 따로 고칠 수 있게 복사
    expect(firstKey(c.xml).fifths).toBe(4);
    expect(parseMusicXML(c.xml).notes[0].midi).toBe(74);
    // 반주가 없으면 반주 칸도 없음
    const d = transposedCopy({ ...base, accXml: undefined, accName: undefined, marks: undefined }, { xml: t, title: 'x' });
    expect('accXml' in d || 'accName' in d || 'marks' in d).toBe(false);
  });
});

describe('열 때 전체 화면', () => {
  afterEach(() => { localStorage.clear(); delete (window as { matchMedia?: unknown }).matchMedia; });
  it('설정은 violin-fullscreen 에 저장', () => {
    expect(fullscreenPref()).toBe(false);
    setFullscreenPref(true);
    expect(localStorage.getItem('violin-fullscreen')).toBe('1');
    expect(fullscreenPref()).toBe(true);
    setFullscreenPref(false);
    expect(fullscreenPref()).toBe(false);
  });
  it('앱이 이미 전체 화면으로 열렸으면 버튼·자동 전체 화면 안 씀', () => {
    expect(appFullscreen()).toBe(false);
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({ matches: q === '(display-mode: fullscreen)' });
    expect(appFullscreen()).toBe(true);
    expect(fsUsable()).toBe(false);
  });
});
