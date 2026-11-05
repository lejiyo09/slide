/** 슬라이드 좌표는 96 DPI 픽셀 */
export const PX_PER_INCH = 96;
export const EMU_PER_PX = 9525;
export const pxToInch = (px: number) => px / PX_PER_INCH;
export const inchToPx = (inch: number) => inch * PX_PER_INCH;
export const ptToPx = (pt: number) => (pt * PX_PER_INCH) / 72;
export const pxToPt = (px: number) => (px * 72) / PX_PER_INCH;
export const pxToEmu = (px: number) => Math.round(px * EMU_PER_PX);
export const emuToPx = (emu: number) => emu / EMU_PER_PX;
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
