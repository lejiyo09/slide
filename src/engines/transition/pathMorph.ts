/**
 * 도형 경로 모핑 (원 → 사각형, 별 → 오각형, 자유형 → 자유형 …).
 * d 문자열의 숫자를 바꿔 끼우지 않고, 두 도형의 윤곽을 같은 구조로 정규화해 점끼리 대응시킨다.
 *  1. SVG path를 절대 좌표 명령으로 해석 (M L H V C S Q T A Z, 상대 명령 포함)
 *  2. 곡선(C·Q·A)을 잘게 나눠 닫힌 윤곽(점 목록)으로 평탄화 — 하위 경로(윤곽)마다 따로
 *  3. 윤곽을 둘레 길이 기준 같은 간격 N개 점으로 다시 샘플링 (곡선 부분도 촘촘하므로 부드러움 유지)
 *  4. 방향 통일 (부호 있는 넓이로 시계/반시계 판단, 다르면 뒤집음)
 *  5. 시작점 정렬 (모든 회전 중 대응점 거리 제곱합이 가장 작은 것)
 *  6. 대응점을 t로 사이값 → 사용자 지정 도형(CustomGeometry, 0..1 좌표)으로 그림
 * 윤곽 수(구멍 수)가 다르면 안정적인 대응이 안 되므로 null → 호출 쪽에서 교차 전환으로 대신한다.
 */
import type { CustomGeometry, PathCommand } from '../../types/model';

type Pt = [number, number];

/** SVG path → 하위 경로별 점 목록 (곡선 평탄화) */
export function flattenPath(d: string, curveSteps = 24): { pts: Pt[]; closed: boolean }[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const subs: { pts: Pt[]; closed: boolean }[] = [];
  let cur: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl: Pt | null = null;
  let lastQ: Pt | null = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const has = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const push = (p: Pt) => cur.push(p);
  const close = (closed: boolean) => {
    if (cur.length > 1) subs.push({ pts: cur, closed });
    cur = [];
  };
  const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => {
    for (let k = 1; k <= curveSteps; k++) {
      const t = k / curveSteps, u = 1 - t;
      push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
  };
  const quad = (p0: Pt, p1: Pt, p2: Pt) => {
    for (let k = 1; k <= curveSteps; k++) {
      const t = k / curveSteps, u = 1 - t;
      push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
  };
  // SVG 호(끝점 표기) → 중심 표기 (SVG 1.1 부록 F.6.5)
  const arc = (x1: number, y1: number, rx: number, ry: number, phi: number, large: number, sweep: number, x2: number, y2: number) => {
    if (rx === 0 || ry === 0) return push([x2, y2]);
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const f = (phi * Math.PI) / 180, cf = Math.cos(f), sf = Math.sin(f);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cf * dx + sf * dy, y1p = -sf * dx + cf * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const sign = large === sweep ? -1 : 1;
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const cx = cf * cxp - sf * cyp + (x1 + x2) / 2, cy = sf * cxp + cf * cyp + (y1 + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * curveSteps / 2));
    for (let k = 1; k <= steps; k++) {
      const t = t1 + (dt * k) / steps;
      push([cx + rx * Math.cos(t) * cf - ry * Math.sin(t) * sf, cy + rx * Math.cos(t) * sf + ry * Math.sin(t) * cf]);
    }
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case 'M': {
        close(false);
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        push([x, y]);
        // M 뒤의 좌표 쌍은 L
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQ = null;
        continue;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        push([x, y]);
        break;
      case 'H':
        x = ox + num();
        push([x, y]);
        break;
      case 'V':
        y = oy + num();
        push([x, y]);
        break;
      case 'C': {
        const p1: Pt = [ox + num(), oy + num()], p2: Pt = [ox + num(), oy + num()], p3: Pt = [ox + num(), oy + num()];
        cubic([x, y], p1, p2, p3);
        lastCtrl = p2;
        [x, y] = p3;
        lastQ = null;
        if (!has()) break;
        continue;
      }
      case 'S': {
        const p1: Pt = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const p2: Pt = [ox + num(), oy + num()], p3: Pt = [ox + num(), oy + num()];
        cubic([x, y], p1, p2, p3);
        lastCtrl = p2;
        [x, y] = p3;
        continue;
      }
      case 'Q': {
        const p1: Pt = [ox + num(), oy + num()], p2: Pt = [ox + num(), oy + num()];
        quad([x, y], p1, p2);
        lastQ = p1;
        [x, y] = p2;
        lastCtrl = null;
        continue;
      }
      case 'T': {
        const p1: Pt = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p2: Pt = [ox + num(), oy + num()];
        quad([x, y], p1, p2);
        lastQ = p1;
        [x, y] = p2;
        continue;
      }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
        const nx = ox + num(), ny = oy + num();
        arc(x, y, rx, ry, phi, large, sweep, nx, ny);
        x = nx;
        y = ny;
        lastCtrl = lastQ = null;
        continue;
      }
      case 'Z':
        x = sx;
        y = sy;
        close(true);
        lastCtrl = lastQ = null;
        continue;
      default:
        i++;
        continue;
    }
    lastCtrl = lastQ = null;
  }
  close(false);
  return subs;
}

/** 둘레 길이 기준 같은 간격 n개 점 (닫힌 윤곽) */
export function resample(pts: Pt[], n: number): Pt[] {
  const ring = [...pts];
  const first = ring[0], last = ring[ring.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-9) ring.push(first);
  const seg: number[] = [0];
  for (let i = 1; i < ring.length; i++) seg.push(seg[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = seg[seg.length - 1] || 1;
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / n;
    while (j < seg.length - 1 && seg[j] < d) j++;
    const a = ring[j - 1], b = ring[j];
    const len = seg[j] - seg[j - 1] || 1;
    const t = (d - seg[j - 1]) / len;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** 부호 있는 넓이 (양수 = 화면 좌표에서 시계 방향) */
export const signedArea = (pts: Pt[]) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;

/** b를 a에 맞춤: 같은 방향, 대응점 거리 제곱합이 가장 작은 시작점 */
export function alignRing(a: Pt[], b: Pt[]): Pt[] {
  let r = Math.sign(signedArea(a)) !== Math.sign(signedArea(b)) ? [...b].reverse() : b;
  const n = r.length;
  let best = 0, bestD = Infinity;
  for (let s = 0; s < n; s++) {
    let d = 0;
    for (let k = 0; k < n && d < bestD; k++) {
      const p = a[k], q = r[(k + s) % n];
      d += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  r = r.map((_, k) => r[(k + best) % n]);
  return r;
}

export interface PathMorph {
  /** 윤곽마다 [시작 점들, 끝 점들] (0..1 정규화 좌표) */
  rings: [Pt[], Pt[]][];
}

/**
 * 두 도형 경로(각자 0..1 좌표로 정규화된 SVG path)의 모핑 준비. 윤곽 수가 다르거나 열린 경로면 null (교차 전환).
 * n: 윤곽마다 점 수
 */
export function preparePathMorph(dA: string, dB: string, n = 128): PathMorph | null {
  const A = flattenPath(dA).filter((s) => s.pts.length > 2);
  const B = flattenPath(dB).filter((s) => s.pts.length > 2);
  if (!A.length || A.length !== B.length) return null;
  if (A.some((s) => !s.closed) || B.some((s) => !s.closed)) return null;
  // 윤곽은 넓이가 큰 것부터 짝 (바깥 윤곽끼리, 구멍끼리)
  const byArea = (x: { pts: Pt[] }[]) => [...x].sort((p, q) => Math.abs(signedArea(q.pts)) - Math.abs(signedArea(p.pts)));
  const a = byArea(A), b = byArea(B);
  return {
    rings: a.map((ra, i) => {
      const pa = resample(ra.pts, n);
      return [pa, alignRing(pa, resample(b[i].pts, n))];
    }),
  };
}

/** t 시점의 경로 → 사용자 지정 도형 (0..1 좌표) */
export function pathMorphAt(m: PathMorph, t: number): CustomGeometry {
  return {
    paths: m.rings.map(([a, b]) => {
      const cmds: PathCommand[] = a.map((p, k) => ({ c: k ? 'L' : 'M', x: p[0] + (b[k][0] - p[0]) * t, y: p[1] + (b[k][1] - p[1]) * t }) as PathCommand);
      cmds.push({ c: 'Z' });
      return { cmds, fill: true, stroke: true };
    }),
  };
}
