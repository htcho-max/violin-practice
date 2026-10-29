// 동기화 열쇠 만들기 (32글자): node new-key.mjs
import { randomBytes } from 'node:crypto';
console.log(randomBytes(24).toString('base64url'));
