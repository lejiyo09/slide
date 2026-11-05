/**
 * 불변 스냅샷 기반 실행 취소/다시 실행.
 * immer의 구조적 공유 덕분에 스냅샷은 변경된 경로만 새로 만들어지므로 메모리 효율적이다.
 */
export interface HistoryEntry<T> {
  state: T;
  label: string;
}

export interface HistoryState<T> {
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
}

export const HISTORY_LIMIT = 200;

export const emptyHistory = <T>(): HistoryState<T> => ({ past: [], future: [] });

/** 변경 직전 상태를 past에 기록 */
export function record<T>(h: HistoryState<T>, before: T, label: string): HistoryState<T> {
  const past = [...h.past, { state: before, label }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo<T>(h: HistoryState<T>, current: T): { history: HistoryState<T>; state: T; label: string } | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return {
    state: prev.state,
    label: prev.label,
    history: { past: h.past.slice(0, -1), future: [{ state: current, label: prev.label }, ...h.future] },
  };
}

export function redo<T>(h: HistoryState<T>, current: T): { history: HistoryState<T>; state: T; label: string } | null {
  const next = h.future[0];
  if (!next) return null;
  return {
    state: next.state,
    label: next.label,
    history: { past: [...h.past, { state: current, label: next.label }], future: h.future.slice(1) },
  };
}
