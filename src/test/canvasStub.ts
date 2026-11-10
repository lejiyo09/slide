/**
 * 테스트(jsdom) 전용: jsdom에는 캔버스 2D 그리기가 없어 Paper.js가 모듈을 불러올 때 실패한다.
 * 불 연산은 그리기를 쓰지 않으므로 아무것도 하지 않는 2D 컨텍스트를 준다. 이 파일을 Paper.js보다 먼저 import한다.
 */
const fake = new Proxy({} as Record<string, unknown>, {
  get(t, k) {
    if (k in t) return t[k as string];
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'measureText') return () => ({ width: 0 });
    if (k === 'canvas') return (t.__canvas ??= document.createElement('canvas'));
    return () => {};
  },
  set(t, k, v) {
    t[k as string] = v;
    return true;
  },
});
if (typeof HTMLCanvasElement !== 'undefined') {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === '2d') return fake as unknown as CanvasRenderingContext2D;
    return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof orig;
}
export {};
