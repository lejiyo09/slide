/** 더블클릭으로 편집을 시작할 때 커서를 놓을 화면 좌표 */
let pending: { x: number; y: number } | null = null;
export const setPendingCaretPoint = (p: { x: number; y: number } | null) => (pending = p);
export const takePendingCaretPoint = () => {
  const p = pending;
  pending = null;
  return p;
};
