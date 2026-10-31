/**
 * 레슨 노트 말로 입력: 브라우저 음성 인식(Web Speech API, 한국어) + 말에서 곡·마디 찾기
 * 예) "자이츠 1악장 23마디 활 더 길게" → 곡 = 자이츠 협주곡 5번 1악장, 마디 23, 글 "활 더 길게"
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// ---- 음성 인식 ----
interface SRResult { 0: { transcript: string }; isFinal: boolean }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;
function ctor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const speechSupported = () => !!ctor();

const ERR: Record<string, string> = {
  'not-allowed': '마이크 사용이 막혀 있어요. 브라우저 주소창 왼쪽 자물쇠 → 마이크를 허용해 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 입력을 쓸 수 없어요 (크롬을 써 주세요).',
  'no-speech': '말소리가 들리지 않았어요. 다시 눌러 말해 주세요.',
  'audio-capture': '마이크를 찾지 못했어요. 다른 앱(채점·튜너)이 마이크를 쓰고 있지 않은지 확인해 주세요.',
  network: '음성 인식에 인터넷이 필요해요.',
};

/** 한 번 말하면(말이 멈추면) 끝. onFinal 에 다듬기 전 글자 전체 */
export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const finalText = useRef('');
  const cb = useRef(onFinal);
  cb.current = onFinal;
  useEffect(() => () => { rec.current?.abort(); }, []);
  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    const C = ctor();
    if (!C) { setError('이 브라우저는 음성 입력을 지원하지 않아요 (크롬을 써 주세요).'); return; }
    rec.current?.abort();
    const r = new C();
    r.lang = 'ko-KR';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = '';
    r.onresult = (e) => {
      let fin = '', mid = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript; else mid += res[0].transcript;
      }
      finalText.current = fin;
      setInterim((fin + mid).trim());
    };
    r.onerror = (e) => { if (e.error !== 'aborted') setError(ERR[e.error] ?? `음성 인식 오류 (${e.error})`); };
    r.onend = () => {
      setListening(false);
      setInterim('');
      const t = finalText.current.trim();
      if (t) cb.current(t);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try { r.start(); } catch { setListening(false); setError('음성 입력을 시작하지 못했어요.'); }
  }, []);
  return { supported: speechSupported(), listening, interim, error, start, stop };
}

// ---- 말에서 곡·마디 찾기 ----
const KO_DIGIT: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
/** "이십삼" → 23, "백이" → 102 (마디 번호에 쓰는 정도만) */
export function koNumber(s: string): number | null {
  if (!/^[영공일이삼사오육칠팔구십백]+$/.test(s)) return null;
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '백') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '십') { total += (cur || 1) * 10; cur = 0; }
    else cur = KO_DIGIT[ch];
  }
  return total + cur;
}

export interface ScoreRef { id: number; title: string }
export interface ParsedNote { text: string; measure?: number; scoreId?: number }

/** 제목을 말에 맞춰 볼 낱말로: 괄호 안 작곡가도, 2글자 이상, 숫자+단위(5번·1악장)는 그대로 */
function titleWords(title: string): string[] {
  return title.replace(/[()·,/\-–:]/g, ' ').split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2 && !/^(협주곡|장조|단조|악장|번)$/.test(w));
}
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 말 → 곡(있으면)·마디(있으면)·남은 글 */
export function parseSpoken(raw: string, scores: ScoreRef[] = []): ParsedNote {
  let text = raw.trim().replace(/\s+/g, ' ');
  const out: ParsedNote = { text };
  // 마디: "23마디", "23 마디", "23번 마디", "23번째 마디", "마디 23", "이십삼 마디" ("이 마디" 같은 한 글자는 숫자로 안 봄)
  const m = /(\d{1,3}|[영공일이삼사오육칠팔구십백]{2,5})\s*(?:번\s*째?|번째)?\s*마디(?:에서|에|의|는|를|부터)?/.exec(text)
    ?? /마디\s*(\d{1,3})(?:번)?(?:에서|에|의|는|를|부터)?/.exec(text);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : koNumber(m[1]);
    if (n !== null && n >= 0 && n <= 999) {
      out.measure = n;
      text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    }
  }
  // 곡: 말에 들어 있는 제목 낱말이 가장 많은(같으면 글자 수가 많은) 악보
  if (scores.length) {
    const said = norm(text);
    let best: { s: ScoreRef; hit: string[]; score: number } | null = null;
    for (const s of scores) {
      const hit = titleWords(s.title).filter((w) => said.includes(norm(w)));
      // "1악장"·"5번" 같은 것만 맞으면 곡을 정하지 않음 (곡 이름 낱말이 하나는 있어야)
      if (!hit.some((w) => !/^\d+(번|악장|권)?$/.test(w))) continue;
      const sc = hit.length * 100 + hit.join('').length;
      if (!best || sc > best.score) best = { s, hit, score: sc };
    }
    if (best) {
      out.scoreId = best.s.id;
      // 앞쪽에 말한 곡 이름 낱말은 글에서 뺌
      let t = text;
      for (;;) {
        const w = best.hit.find((h) => norm(t).startsWith(norm(h)));
        if (!w) break;
        let i = 0, k = 0;
        const target = norm(w);
        while (i < t.length && k < target.length) { if (!/\s/.test(t[i])) k++; i++; }
        t = t.slice(i).replace(/^(?:은|는|이|가|을|를|의|에서|에|도)(?=\s|,|$)/, '').replace(/^[\s,]+/, '').trim();
      }
      if (t) text = t;
    }
  }
  out.text = text.replace(/^[\s,.]+/, '').trim();
  return out;
}
