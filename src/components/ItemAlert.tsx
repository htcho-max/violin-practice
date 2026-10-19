import { useSession } from '../state/session';

/** 연습 항목 시간이 끝났을 때 화면 위에 뜨는 안내 (어느 탭에서든) */
export function ItemAlert() {
  const { session, alert, dismissAlert, goto } = useSession();
  if (alert === null || !session) return null;
  const cur = session.items[alert];
  const next = session.items[alert + 1];
  return (
    <div className="item-alert" role="alert" data-testid="item-alert">
      <span><b>{cur?.label ?? '이 항목'}</b> 시간이 끝났어요{next ? <> — 다음: <b>{next.label}</b></> : ' — 마지막 항목이에요'}</span>
      <span className="item-alert-btns">
        {next && <button className="primary mini" onClick={() => { if (session.index === alert) goto(alert + 1); dismissAlert(); }} data-testid="item-alert-next">다음으로</button>}
        <button className="mini" onClick={dismissAlert} data-testid="item-alert-close">{next ? '조금 더' : '확인'}</button>
      </span>
    </div>
  );
}
