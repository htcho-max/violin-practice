// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseMusicXML } from '../src/score/parse';
import { planPlayback, applyFermatas, expandOrnaments, FERMATA, GRACE, type Plan } from '../src/score/player';

// 가짜 AudioContext: 시작한 소리 노드 수만 셈
const started: number[] = [];
const fake = {
  currentTime: 0, state: 'running', sampleRate: 44100, baseLatency: 0,
  destination: {},
  createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect(x: unknown) { return x; }, disconnect() {} }),
  createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, connect(x: unknown) { return x; } }),
  createOscillator: () => ({ type: '', frequency: { value: 0 }, setPeriodicWave() {}, connect(x: unknown) { return x; }, start(t: number) { started.push(t); }, stop() {}, addEventListener() {} }),
  createPeriodicWave: () => ({}),
};
vi.mock('../src/audio/context', () => ({ resumeAudio: async () => fake, getAudioContext: () => fake }));
vi.mock('../src/audio/violinSampler', () => ({ loadViolinSamples: async () => false, loadSampleSet: async () => false, scheduleViolinNote: () => null }));

const n = (step: string, oct: number, dur: number, extra = '', grace = false) =>
  `<note>${grace ? '<grace/>' : ''}<pitch><step>${step}</step><octave>${oct}</octave></pitch>${grace ? '' : `<duration>${dur}</duration>`}<voice>1</voice><type>quarter</type>${extra}</note>`;
const XML = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
${n('A', 4, 1, '<notations><fermata/></notations>')}${n('C', 5, 0, '', true)}${n('B', 4, 1)}${n('E', 5, 2, '<notations><ornaments><trill-mark/></ornaments></notations>')}</measure>
</part></score-partwise>`;

describe('늘임표·꾸밈음·트릴', () => {
  const s = parseMusicXML(XML);
  it('읽기: 채점용 음 수·박은 그대로', () => {
    expect(s.notes.map((x) => x.midi)).toEqual([69, 71, 76]);
    expect(s.notes.map((x) => x.beat)).toEqual([0, 1, 2]);
    expect(s.notes[0].art?.fermata).toBe(true);
    expect(s.notes[1].art?.grace).toEqual([72]);
    expect(s.notes[2].art?.orn).toEqual({ kind: 'trill', upper: 78, lower: 74 }); // G장조: E 위는 F#
  });
  it('늘임표는 그 음을 늘리고 뒤를 밈', () => {
    const p = planPlayback(s, { bpm: 60, from: 1, to: 1, countIn: false });
    expect(p.events[0].dur).toBeCloseTo(FERMATA);
    expect(p.events[1].time).toBeCloseTo(FERMATA);
    expect(p.total).toBeCloseTo(4 + FERMATA - 1);
    const plain: Plan = { events: [], acc: [], clicks: [], total: 1 };
    expect(applyFermatas(plain)).toBe(plain);
  });
  it('꾸밈음은 앞에서 짧게, 트릴은 위아래로', () => {
    const p = planPlayback(s, { bpm: 60, from: 1, to: 1, countIn: false });
    const g = expandOrnaments(p.events[1], 0.8);
    expect(g[0]).toMatchObject({ midi: 72, time: p.events[1].time - GRACE });
    const t = expandOrnaments(p.events[2], 1.7);
    expect(new Set(t.map((x) => x.midi))).toEqual(new Set([76, 78]));
    expect(t[t.length - 1].midi).toBe(76);
    expect(t.length).toBeGreaterThan(10);
  });
});

describe('조금씩 예약하는 재생', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('2.5초 앞까지만 예약하고, 시간이 가면 이어서 예약', async () => {
    vi.useFakeTimers();
    const { scorePlayer } = await import('../src/score/player');
    const long = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${Array.from({ length: 10 }, (_, i) =>
      `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${n('A', 4, 1).repeat(4)}</measure>`).join('')}</part></score-partwise>`;
    const plan = planPlayback(parseMusicXML(long), { bpm: 60, from: 1, to: 10, countIn: false });
    started.length = 0; fake.currentTime = 0;
    await scorePlayer.play(plan, { a4: 440, click: false, voice: 'synth' });
    const first = started.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(40);
    expect(Math.max(...started)).toBeLessThan(0.15 + 2.6);
    fake.currentTime = 10; vi.advanceTimersByTime(300);
    expect(started.length).toBeGreaterThan(first);
    const mid = started.length;
    scorePlayer.stop();
    fake.currentTime = 30; vi.advanceTimersByTime(1000);
    expect(started.length).toBe(mid);
  });
});
