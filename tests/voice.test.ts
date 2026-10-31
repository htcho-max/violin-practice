import { describe, expect, it } from 'vitest';
import { koNumber, parseSpoken } from '../src/lesson/voice';

const scores = [
  { id: 1, title: '협주곡 5번 D장조 1악장 (자이츠)' },
  { id: 2, title: '협주곡 5번 D장조 3악장 (자이츠)' },
  { id: 3, title: '협주곡 A단조 1악장 (비발디)' },
  { id: 4, title: '세브치크 Op.2 No.6 · 변형 41 (스타카토)' },
  { id: 5, title: '갈망' },
];

describe('말로 레슨 노트', () => {
  it('마디 찾기', () => {
    expect(parseSpoken('23마디 활 더 길게')).toEqual({ text: '활 더 길게', measure: 23 });
    expect(parseSpoken('활을 길게 23 마디에서')).toEqual({ text: '활을 길게', measure: 23 });
    expect(parseSpoken('17번째 마디는 3포지션으로')).toEqual({ text: '3포지션으로', measure: 17 });
    expect(parseSpoken('마디 8 비브라토 천천히')).toEqual({ text: '비브라토 천천히', measure: 8 });
    expect(parseSpoken('이십삼 마디 음정 높음')).toEqual({ text: '음정 높음', measure: 23 });
    // "이 마디" 는 숫자가 아님
    expect(parseSpoken('이 마디에서 활을 아껴')).toEqual({ text: '이 마디에서 활을 아껴' });
    expect(parseSpoken('윗반활에서 지판 쪽으로 가지 않기')).toEqual({ text: '윗반활에서 지판 쪽으로 가지 않기' });
  });

  it('곡 찾기: 곡 이름 + 악장으로 고르고 앞에 말한 곡 이름은 글에서 뺌', () => {
    expect(parseSpoken('자이츠 1악장 23마디 활 더 길게', scores)).toEqual({ text: '활 더 길게', measure: 23, scoreId: 1 });
    expect(parseSpoken('자이츠 3악장 스타카토 가볍게', scores)).toEqual({ text: '스타카토 가볍게', scoreId: 2 });
    expect(parseSpoken('비발디 52마디 셋잇단 고르게', scores)).toEqual({ text: '셋잇단 고르게', measure: 52, scoreId: 3 });
    expect(parseSpoken('갈망은 처음부터 크게', scores)).toEqual({ text: '처음부터 크게', scoreId: 5 });
    // "1악장" 만으로는 곡을 정하지 않음
    expect(parseSpoken('1악장 템포 천천히', scores)).toEqual({ text: '1악장 템포 천천히' });
    // 곡 이름이 뒤에 있으면 글은 그대로
    expect(parseSpoken('활 길게 비발디', scores)).toEqual({ text: '활 길게 비발디', scoreId: 3 });
  });

  it('한글 숫자', () => {
    expect([koNumber('이십삼'), koNumber('백이'), koNumber('십'), koNumber('구십구'), koNumber('활')]).toEqual([23, 102, 10, 99, null]);
  });
});
