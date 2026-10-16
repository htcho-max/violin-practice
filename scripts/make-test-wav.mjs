// 스모크 테스트용 가짜 마이크 소리 (바이올린형 배음, 48kHz)
//  a445.wav    : A4 +20센트 계속 (튜너)
//  phrases.wav : 음계 + 포지션 이동(도착 +25센트 → 고쳐 잡음) 반복
//  vibrato.wav : A4 비브라토 6Hz ±25센트
import { writeFileSync } from 'node:fs';
const sr = 48000, H = [1, 0.8, 0.6, 0.5, 0.35, 0.3, 0.2];
const f = (m, c = 0) => 440 * 2 ** ((m - 69) / 12 + c / 1200);

function write(name, dur, freqAt) {
  const n = Math.floor(sr * dur), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const fr = freqAt(i / sr);
    let v = 0;
    if (fr) { ph += (2 * Math.PI * fr) / sr; H.forEach((a, k) => { v += a * Math.sin((k + 1) * ph); }); }
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.12)) * 32767), 44 + i * 2);
  }
  writeFileSync(`scripts/${name}`, buf);
}

write('a445.wav', 10, () => 445);

// [시작, 끝, 주파수함수]
const plan = [
  [0.0, 0.6, () => f(69)], [0.6, 1.2, () => f(71, 12)], [1.2, 1.8, () => f(73, -6)], [1.8, 2.4, () => f(74)],
  [2.6, 3.1, () => f(71)], [3.1, 4.1, (t) => f(74, t < 3.45 ? 25 : 0)], // 이동: +25 로 도착 → 고침
];
write('phrases.wav', 4.4, (t) => { const p = plan.find(([a, b]) => t >= a && t < b); return p ? p[2](t) : null; });

write('vibrato.wav', 10, (t) => f(69, 25 * Math.sin(2 * Math.PI * 6 * t)));
