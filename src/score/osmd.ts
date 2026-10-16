import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** 라이브러리는 악보 화면을 열 때만 불러옴 */
export async function createOSMD(el: HTMLElement): Promise<OpenSheetMusicDisplay> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  return new OpenSheetMusicDisplay(el, {
    autoResize: true,
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

/**
 * 채점 결과로 음표 머리 색칠. colors: "마디:순서" → 색 (parse.ts 와 같은 순서: 1성부, 꾸밈음·쉼표 제외, 화음은 하나로)
 * 빈 맵이면 색을 지움.
 */
export function colorNotes(osmd: OpenSheetMusicDisplay, colors: Map<string, string>) {
  const sheet = osmd.Sheet;
  if (!sheet) return;
  for (const sm of sheet.SourceMeasures) {
    const num = sm.MeasureNumberXML ?? sm.MeasureNumber;
    let k = 0;
    for (const container of sm.VerticalSourceStaffEntryContainers) {
      for (const se of container.StaffEntries) {
        if (!se) continue;
        for (const ve of se.VoiceEntries) {
          if (ve.IsGrace || ve.ParentVoice?.VoiceId !== 1) continue;
          const notes = ve.Notes.filter((n) => !n.isRest());
          if (!notes.length) continue;
          const c = colors.get(`${num}:${k}`);
          for (const n of notes) n.NoteheadColor = c ?? '';
          k++;
        }
      }
    }
  }
}

/** "마디:순서" → 그려진 음표의 SVG id 들 (재생 중 현재 음 강조용) */
export function noteElements(osmd: OpenSheetMusicDisplay): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const list = osmd.GraphicSheet?.MeasureList ?? [];
  for (const staves of list) {
    const gm = staves?.[0];
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
        out.set(`${num}:${k}`, els);
        k++;
      }
    }
  }
  return out;
}
