/**
 * 슬라이드 전환 효과 (자체 구현): 진행률 p(0..1) → 이전/다음 슬라이드 레이어 스타일.
 * 이전 슬라이드가 아래, 다음 슬라이드가 위에 그려진다 (uncover는 반대).
 */
import type { CSSProperties } from 'react';
import type { SlideTransition, TransitionType } from '../../types/model';

export interface TransitionDef {
  id: TransitionType;
  name: string;
  directions?: NonNullable<SlideTransition['direction']>[];
  defaultDuration: number;
}

export const TRANSITIONS: TransitionDef[] = [
  { id: 'none', name: '없음', defaultDuration: 0 },
  { id: 'fade', name: '페이드', defaultDuration: 700 },
  { id: 'fadeBlack', name: '검정으로 페이드', defaultDuration: 1000 },
  { id: 'push', name: '밀어내기', directions: ['up', 'down', 'left', 'right'], defaultDuration: 1000 },
  { id: 'wipe', name: '닦아내기', directions: ['left', 'right', 'up', 'down'], defaultDuration: 1000 },
  { id: 'split', name: '분할', directions: ['verticalOut', 'verticalIn', 'horizontalOut', 'horizontalIn'], defaultDuration: 1000 },
  { id: 'cover', name: '덮기', directions: ['left', 'right', 'up', 'down'], defaultDuration: 1000 },
  { id: 'uncover', name: '나타내기', directions: ['left', 'right', 'up', 'down'], defaultDuration: 1000 },
  { id: 'circle', name: '원형', defaultDuration: 1000 },
  { id: 'zoom', name: '확대/축소', defaultDuration: 700 },
  { id: 'rotate', name: '회전', defaultDuration: 1200 },
  { id: 'flip', name: '뒤집기', directions: ['left', 'right'], defaultDuration: 1000 },
];

export const DIRECTION_NAMES: Record<string, string> = {
  left: '왼쪽으로',
  right: '오른쪽으로',
  up: '위로',
  down: '아래로',
  verticalOut: '세로 바깥쪽',
  verticalIn: '세로 안쪽',
  horizontalOut: '가로 바깥쪽',
  horizontalIn: '가로 안쪽',
};

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** 이동 방향 → 다음 슬라이드가 들어오는 시작 오프셋(%) */
const enterFrom = (dir: string | undefined): [number, number] => {
  switch (dir) {
    case 'right':
      return [-100, 0];
    case 'up':
      return [0, 100];
    case 'down':
      return [0, -100];
    default: // left: 오른쪽에서 왼쪽으로 이동
      return [100, 0];
  }
};

export interface TransitionFrame {
  prev: CSSProperties;
  next: CSSProperties;
  /** 검정 덮개 불투명도 (검정으로 페이드) */
  black?: number;
  /** 이전 슬라이드를 위에 그림 (uncover) */
  prevOnTop?: boolean;
}

export function transitionFrame(t: SlideTransition, raw: number): TransitionFrame {
  const p = Math.max(0, Math.min(1, raw));
  const e = ease(p);
  const dir = t.direction;
  switch (t.type) {
    case 'none':
      return { prev: { opacity: p >= 1 ? 0 : 1 }, next: { opacity: p >= 1 ? 1 : 0 } };
    case 'fade':
      return { prev: {}, next: { opacity: e } };
    case 'fadeBlack':
      return p < 0.5 ? { prev: {}, next: { opacity: 0 }, black: e * 2 } : { prev: { opacity: 0 }, next: {}, black: 2 - e * 2 };
    case 'push': {
      const [fx, fy] = enterFrom(dir);
      return {
        prev: { transform: `translate(${-fx * e}%, ${-fy * e}%)` },
        next: { transform: `translate(${fx * (1 - e)}%, ${fy * (1 - e)}%)` },
      };
    }
    case 'cover': {
      const [fx, fy] = enterFrom(dir);
      return { prev: {}, next: { transform: `translate(${fx * (1 - e)}%, ${fy * (1 - e)}%)` } };
    }
    case 'uncover': {
      const [fx, fy] = enterFrom(dir);
      return { prev: { transform: `translate(${-fx * e}%, ${-fy * e}%)` }, next: {}, prevOnTop: true };
    }
    case 'wipe': {
      const h = `${((1 - e) * 100).toFixed(2)}%`;
      const clip = dir === 'right' ? `inset(0 ${h} 0 0)` : dir === 'up' ? `inset(${h} 0 0 0)` : dir === 'down' ? `inset(0 0 ${h} 0)` : `inset(0 0 0 ${h})`;
      return { prev: {}, next: { clipPath: clip } };
    }
    case 'split': {
      const half = `${((1 - e) * 50).toFixed(2)}%`;
      const vertical = !dir || dir.startsWith('vertical');
      const out = !dir || dir.endsWith('Out');
      if (out) return { prev: {}, next: { clipPath: vertical ? `inset(0 ${half} 0 ${half})` : `inset(${half} 0 ${half} 0)` } };
      // 안쪽: 이전 슬라이드가 가운데로 닫히며 사라짐
      const gone = `${(e * 50).toFixed(2)}%`;
      return { prev: { clipPath: vertical ? `inset(0 ${gone} 0 ${gone})` : `inset(${gone} 0 ${gone} 0)` }, next: {}, prevOnTop: true };
    }
    case 'circle':
      return { prev: {}, next: { clipPath: `circle(${(e * 75).toFixed(2)}% at 50% 50%)` } };
    case 'zoom':
      return { prev: { opacity: 1 - e, transform: `scale(${1 + 0.3 * e})` }, next: { opacity: e, transform: `scale(${0.6 + 0.4 * e})` } };
    case 'rotate':
      return { prev: { opacity: 1 - e }, next: { opacity: e, transform: `rotate(${(-90 * (1 - e)).toFixed(2)}deg) scale(${0.5 + 0.5 * e})` } };
    case 'flip': {
      const sign = dir === 'right' ? -1 : 1;
      return p < 0.5
        ? { prev: { transform: `perspective(1600px) rotateY(${sign * 180 * p}deg)` }, next: { opacity: 0 } }
        : { prev: { opacity: 0 }, next: { transform: `perspective(1600px) rotateY(${sign * -180 * (1 - p)}deg)` } };
    }
  }
}

export const DEFAULT_TRANSITION: SlideTransition = { type: 'none', duration: 0, advanceOnClick: true };
