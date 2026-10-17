import { Component, type ReactNode } from 'react';

/** 화면 하나가 오류로 멈춰도 하얀 화면 대신 안내와 다시 열기 버튼 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ margin: 16 }} role="alert">
        <b>화면을 보여주다 문제가 생겼어요.</b>
        <p className="hint">연습 기록은 그대로 있어요. 다시 열어 보세요.</p>
        <p className="muted small">{String(this.state.error.message || this.state.error)}</p>
        <button className="primary" onClick={() => { try { localStorage.setItem('violin-tab', 'today'); } catch { /* 무시 */ } location.reload(); }}>다시 열기</button>
      </div>
    );
  }
}
