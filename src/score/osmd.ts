import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** 라이브러리는 악보 화면을 열 때만 불러옴 */
export async function createOSMD(el: HTMLElement): Promise<OpenSheetMusicDisplay> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  return new OpenSheetMusicDisplay(el, {
    autoResize: false, // 크기 변화는 화면에서 직접 (재생 중 강조가 끊기지 않게)
    backend: 'svg',
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawPartNames: false,
    drawCredits: false,
    drawingParameters: 'compacttight',
    followCursor: false,
  });
}

type AnyNote = { NoteTie?: { StartNote?: unknown }; isRest: () => boolean };
/** 붙임줄로 이어진 뒤쪽 음인지 */
const isTieCont = (n: AnyNote) => !!n.NoteTie && n.NoteTie.StartNote !== undefined && n.NoteTie.StartNote !== n;
type HasInst = { ParentStaff?: { ParentInstrument?: unknown } };
const instOf = (x: unknown) => (x as HasInst)?.ParentStaff?.ParentInstrument;

/** 여러 파트 악보: 내 파트만 보이게 (others=true 면 모두 보이게) */
export function showParts(osmd: OpenSheetMusicDisplay, mine: number, others: boolean) {
  const insts = osmd.Sheet?.Instruments ?? [];
  insts.forEach((ins, i) => { ins.Visible = others || i === mine; });
}

/**
 * 채점 결과로 음표 머리 색칠. colors: "마디:순서" → 색 (parse.ts 와 같은 순서: 내 파트 1성부, 꾸밈음·쉼표·붙임줄 뒤 음 제외, 화음은 하나로)
 * 빈 맵이면 색을 지움. 붙임줄 뒤 음은 앞 음과 같은 색.
 */
export function colorNotes(osmd: OpenSheetMusicDisplay, colors: Map<string, string>, part = 0) {
  const sheet = osmd.Sheet;
  if (!sheet) return;
  const inst = sheet.Instruments[part];
  const tieColor = new Map<unknown, string>();
  for (const sm of sheet.SourceMeasures) {
    const num = sm.MeasureNumberXML ?? sm.MeasureNumber;
    let k = 0;
    for (const container of sm.VerticalSourceStaffEntryContainers) {
      for (const se of container.StaffEntries) {
        if (!se || (inst && instOf(se) && instOf(se) !== inst)) continue;
        for (const ve of se.VoiceEntries) {
          if (ve.IsGrace || ve.ParentVoice?.VoiceId !== 1) continue;
          const notes = ve.Notes.filter((n) => !n.isRest());
          if (!notes.length) continue;
          if (notes.every((n) => isTieCont(n as unknown as AnyNote))) {
            for (const n of notes) n.NoteheadColor = tieColor.get((n as unknown as AnyNote).NoteTie!.StartNote) ?? '';
            continue;
          }
          const c = colors.get(`${num}:${k}`);
          for (const n of notes) { n.NoteheadColor = c ?? ''; tieColor.set(n, c ?? ''); }
          k++;
        }
      }
    }
  }
}

/** "마디:순서" → 그려진 음표의 SVG id 들 (재생 중 현재 음 강조용). 붙임줄 뒤 음도 앞 음 열쇠에 넣음 */
export function noteElements(osmd: OpenSheetMusicDisplay, part = 0): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const inst = osmd.Sheet?.Instruments[part];
  const keyOf = new Map<unknown, string>();
  const list = osmd.GraphicSheet?.MeasureList ?? [];
  for (const staves of list) {
    const gm = (staves ?? []).find((g) => g && (!inst || !instOf(g) || instOf(g) === inst));
    if (!gm) continue;
    const num = gm.parentSourceMeasure.MeasureNumberXML ?? gm.parentSourceMeasure.MeasureNumber;
    let k = 0;
    for (const se of gm.staffEntries) {
      for (const gve of se.graphicalVoiceEntries) {
        const ve = gve.parentVoiceEntry;
        if (ve.IsGrace || ve.ParentVoice?.VoiceId !== 1) continue;
        const gns = gve.notes.filter((n) => !n.sourceNote.isRest());
        if (!gns.length) continue;
        // 요소는 다시 그려질 수 있어서 id 만 저장 (vf-<id>)
        const els = gns
          .map((n) => (n as unknown as { getSVGId?: () => string }).getSVGId?.())
          .filter((x): x is string => !!x);
        if (gns.every((n) => isTieCont(n.sourceNote as unknown as AnyNote))) {
          const key = keyOf.get((gns[0].sourceNote as unknown as AnyNote).NoteTie!.StartNote);
          if (key) out.set(key, [...(out.get(key) ?? []), ...els]);
          continue;
        }
        const key = `${num}:${k}`;
        gns.forEach((n) => keyOf.set(n.sourceNote, key));
        out.set(key, els);
        k++;
      }
    }
  }
  return out;
}

/**
 * 다시 그리지 않고 이미 그려진 음표 머리 색만 바꿈. els: noteElements 결과, colors: "마디:순서" → 색 (없으면 원래 색)
 * 처음 바꿀 때 원래 색을 data-fill0 에 적어 두고, 색을 지우면 그 색으로 돌림.
 */
export function paintNotes(els: Map<string, string[]>, colors: Map<string, string>, root: ParentNode = document) {
  for (const [key, ids] of els) {
    const c = colors.get(key);
    for (const id of ids) {
      const g = (root as Document).getElementById?.(`vf-${id}`) ?? (root as Document).getElementById?.(id) ?? root.querySelector(`[id="vf-${id}"]`);
      if (!g) continue;
      for (const p of Array.from(g.querySelectorAll('.vf-notehead path, .vf-notehead text'))) {
        if (!p.hasAttribute('data-fill0')) { p.setAttribute('data-fill0', p.getAttribute('fill') ?? ''); p.setAttribute('data-stroke0', p.getAttribute('stroke') ?? ''); }
        const f0 = p.getAttribute('data-fill0') ?? '', s0 = p.getAttribute('data-stroke0') ?? '';
        const fill = c ?? f0, stroke = c ?? s0;
        if (fill) p.setAttribute('fill', fill); else p.removeAttribute('fill');
        if (stroke) p.setAttribute('stroke', stroke); else p.removeAttribute('stroke');
      }
    }
  }
}
