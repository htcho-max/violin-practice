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
