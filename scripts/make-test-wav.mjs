// 스모크 테스트용 가짜 마이크 소리: 445Hz(A4 +20센트), 바이올린형 배음, 10초
import { writeFileSync } from 'node:fs';
const sr = 48000, f = 445, h = [1, 0.8, 0.6, 0.5, 0.35, 0.3, 0.2], n = sr * 10;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  let v = 0;
  h.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f * (k + 1) * i / sr + 0.3 * k); });
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.12)) * 32767), 44 + i * 2);
}
writeFileSync('scripts/a445.wav', buf);
