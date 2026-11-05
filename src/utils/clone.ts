import { current, isDraft } from 'immer';
/** immer draft에도 안전한 깊은 복제 */
export function deepClone<T>(v: T): T {
  return structuredClone(isDraft(v) ? (current(v as never) as T) : v);
}
