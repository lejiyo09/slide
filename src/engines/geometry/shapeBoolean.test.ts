import '../../test/canvasStub';
import { describe, expect, it } from 'vitest';
import { createShape } from '../../core/document/factory';
import type { GroupObject, ShapeObject, SlideObject } from '../../types/model';
import { mergeObjects, presetToGeometry, shapeArea, shapeContains, type MergedShape, type MergeOp } from './shapeBoolean';

const circle = (x: number, y: number, d = 100, extra: Partial<ShapeObject> = {}) => ({ ...createShape('ellipse', x, y, d, d), id: `c${x}_${y}`, ...extra }) as ShapeObject;
const rect = (x: number, y: number, w: number, h: number, extra: Partial<ShapeObject> = {}) => ({ ...createShape('rect', x, y, w, h), id: `r${x}_${y}`, ...extra }) as ShapeObject;
const run = (op: MergeOp, objs: SlideObject[]) => mergeObjects(op, objs).shapes;
const area = (s: MergedShape[]) => s.reduce((n, x) => n + shapeArea(x), 0);
const close = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b) / b).toBeLessThan(rel);

// 원 두 개 (반지름 50, 중심 거리 60): 렌즈 넓이 = 2r²·acos(d/2r) − (d/2)·√(4r²−d²)
const CIRCLE = Math.PI * 2500;
const LENS = 5000 * Math.acos(0.6) - 30 * 80;

describe('A. 부분 중첩 (원 2개)', () => {
  const A = circle(0, 0), B = circle(60, 0);
  it('통합 = A + B − 겹침, 가운데 경계 없이 하나', () => {
    const r = run('union', [A, B]);
    expect(r).toHaveLength(1);
    close(area(r), 2 * CIRCLE - LENS);
    expect(shapeContains(r[0], 80, 50)).toBe(true); // 겹친 곳
    // 하위 경로 하나 (안쪽 경계 없음)
    expect(r[0].geometry.paths[0].cmds.filter((c) => c.c === 'M')).toHaveLength(1);
  });
  it('결합 = 겹친 곳 제거', () => {
    const r = run('combine', [A, B]);
    close(area(r), 2 * CIRCLE - 2 * LENS);
    expect(shapeContains(r[0], 80, 50)).toBe(false);
    expect(shapeContains(r[0], 20, 50)).toBe(true);
  });
  it('교차 = 렌즈', () => {
    const r = run('intersect', [A, B]);
    close(area(r), LENS);
    expect(shapeContains(r[0], 80, 50)).toBe(true);
    expect(shapeContains(r[0], 20, 50)).toBe(false);
  });
  it('빼기 = 첫 선택 − 나머지 (순서가 바뀌면 결과도 바뀜)', () => {
    const ab = run('subtract', [A, B]), ba = run('subtract', [B, A]);
    close(area(ab), CIRCLE - LENS);
    expect(shapeContains(ab[0], 20, 50)).toBe(true);
    expect(shapeContains(ba[0], 20, 50)).toBe(false);
    expect(shapeContains(ba[0], 140, 50)).toBe(true);
  });
  it('조각 = 독립된 세 영역 (A만, 겹침, B만)', () => {
    const r = run('fragment', [A, B]);
    expect(r).toHaveLength(3);
    const areas = r.map(shapeArea).sort((a, b) => a - b);
    close(areas[0], LENS);
    close(areas[1], CIRCLE - LENS);
    close(areas[2], CIRCLE - LENS);
    close(area(r), 2 * CIRCLE - LENS);
  });
});

describe('B. 완전히 분리 (사각형 2개)', () => {
  const A = rect(0, 0, 100, 100), B = rect(300, 0, 100, 50);
  it('통합·결합: 떨어진 영역을 억지로 잇지 않고 두 윤곽, 교차: 빈 결과, 조각: 두 개', () => {
    const u = run('union', [A, B]);
    expect(u).toHaveLength(1);
    expect(u[0].geometry.paths[0].cmds.filter((c) => c.c === 'M')).toHaveLength(2);
    close(area(u), 15000);
    expect(shapeContains(u[0], 200, 25)).toBe(false);
    close(area(run('combine', [A, B])), 15000);
    expect(run('intersect', [A, B])).toEqual([]);
    expect(run('fragment', [A, B])).toHaveLength(2);
  });
});

describe('C. 내부 포함', () => {
  it('큰 원 − 작은 원 = 도넛 (가운데가 실제로 비어 있음)', () => {
    const r = run('subtract', [circle(0, 0, 200), circle(50, 50, 100)]);
    expect(r).toHaveLength(1);
    close(area(r), Math.PI * (10000 - 2500));
    expect(shapeContains(r[0], 100, 100)).toBe(false);
    expect(shapeContains(r[0], 20, 100)).toBe(true);
    // 바깥 윤곽 + 구멍 = 하위 경로 2개
    expect(r[0].geometry.paths[0].cmds.filter((c) => c.c === 'M')).toHaveLength(2);
  });
  it('조각: 안쪽 원과 바깥 고리 두 조각', () => {
    const r = run('fragment', [circle(0, 0, 200), circle(50, 50, 100)]);
    expect(r).toHaveLength(2);
    close(r.map(shapeArea).sort((a, b) => a - b)[0], 2500 * Math.PI);
  });
});

describe('D. 세 개 이상', () => {
  const A = circle(0, 0), B = circle(60, 0), C = circle(30, 50);
  it('조각 = 7개 영역(각각만·두 개씩·셋 다), 넓이 합 = 통합 넓이', () => {
    const f = run('fragment', [A, B, C]);
    expect(f).toHaveLength(7);
    close(area(f), area(run('union', [A, B, C])));
  });
  it('교차 = 셋 다 겹친 곳 = 조각 중 가장 작은 것 / 결합 = 홀수 번 덮인 곳', () => {
    const f = run('fragment', [A, B, C]);
    const smallest = Math.min(...f.map(shapeArea));
    const inter = run('intersect', [A, B, C]);
    close(area(inter), smallest, 0.02);
    const comb = run('combine', [A, B, C])[0];
    // 세 원의 중심 (셋 다 덮음 = 3번, 홀수) → 포함 / 두 원만 덮인 곳 (2번, 짝수) → 빠짐
    expect(shapeContains(comb, 80, 65)).toBe(true);
    expect(shapeContains(comb, 80, 15)).toBe(false);
    expect(shapeContains(comb, 10, 30)).toBe(true);
  });
  it('빼기 = A − (B ∪ C)', () => {
    const r = run('subtract', [A, B, C]);
    expect(shapeContains(r[0], 15, 30)).toBe(true);
    expect(shapeContains(r[0], 70, 50)).toBe(false);
    expect(shapeContains(r[0], 40, 85)).toBe(false);
  });
  it('10개 겹친 원도 조각 계산 (성능)', () => {
    const many = Array.from({ length: 10 }, (_, i) => circle(i * 30, (i % 2) * 30));
    const t0 = performance.now();
    const f = run('fragment', many);
    const ms = performance.now() - t0;
    expect(f.length).toBeGreaterThan(10);
    close(area(f), area(run('union', many)));
    expect(ms).toBeLessThan(8000);
  });
});

describe('E. 똑같은 원 두 개', () => {
  const A = circle(0, 0), B = { ...circle(0, 0), id: 'same' };
  it('통합·교차 = 원 하나, 결합·빼기 = 빈 결과, 조각 = 한 조각', () => {
    close(area(run('union', [A, B])), CIRCLE);
    close(area(run('intersect', [A, B])), CIRCLE);
    expect(run('combine', [A, B])).toEqual([]);
    expect(run('subtract', [A, B])).toEqual([]);
    expect(run('fragment', [A, B])).toHaveLength(1);
  });
});

describe('F·H. 회전·뒤집기·그룹 좌표 변환', () => {
  it('45° 회전한 사각형 ∩ 가운데 원 = 원 (사각형 폭 50 안에 반지름 20), 회전 방향의 끝이 포함', () => {
    const R = rect(0, 0, 200, 50, { rotation: 45 });
    const C = circle(80, 5, 40);
    close(area(run('intersect', [R, C])), Math.PI * 400);
    const u = run('union', [R, C])[0];
    expect(shapeContains(u, 100 + 63, 25 + 63)).toBe(true); // 대각선 아래 오른쪽 (회전함)
    expect(shapeContains(u, 190, 25)).toBe(false); // 회전 전 자리
  });
  it('뒤집은 직각삼각형은 뒤집힌 모양으로', () => {
    const t = { ...createShape('rightTriangle', 0, 0, 100, 100), id: 't', flipH: true } as ShapeObject;
    const u = run('union', [t, rect(500, 500, 10, 10)])[0];
    // 직각삼각형(왼쪽 아래 직각)을 좌우로 뒤집으면 오른쪽 아래 직각
    expect(shapeContains(u, 90, 50)).toBe(true);
    expect(shapeContains(u, 10, 50)).toBe(false);
  });
  it('90° 회전한 그룹 안의 원 두 개 → 회전이 반영된 자리', () => {
    const g: GroupObject = { id: 'g', type: 'group', name: '그룹', x: 100, y: 100, width: 200, height: 100, rotation: 90, children: [circle(0, 0), circle(60, 0)] };
    const r = mergeObjects('union', [g]);
    expect(r.operands).toBe(2);
    const b = r.shapes[0];
    // 원 중심 (150,150)·(210,150)이 그룹 가운데 (200,150) 기준 90° → (200,100)·(200,160)
    close(b.x, 150, 0.01);
    close(b.y, 50, 0.01);
    close(b.width, 100, 0.01);
    close(b.height, 160, 0.01);
  });
});

describe('G. 곡선', () => {
  it('원·타원·둥근 사각형·자유형: 곡선은 베지어로 남고, 포함·배제 원리로 넓이가 맞음', () => {
    const E = { ...createShape('ellipse', 0, 0, 200, 100), id: 'e' } as ShapeObject;
    const RR = { ...createShape('roundRect', 120, 20, 150, 120), id: 'rr' } as ShapeObject;
    const u = run('union', [E, RR])[0], i = run('intersect', [E, RR]), ea = area(run('union', [E, { ...E, id: 'e2' }])), ra = area(run('union', [RR, { ...RR, id: 'rr2' }]));
    close(shapeArea(u), ea + ra - area(i));
    expect(u.geometry.paths[0].cmds.some((c) => c.c === 'C')).toBe(true);
    const free = { ...createShape('custom', 50, 50, 100, 100), id: 'f', geometry: { paths: [{ cmds: [{ c: 'M', x: 0, y: 1 }, { c: 'C', x1: 0.2, y1: 0, x2: 0.8, y2: 0, x: 1, y: 1 }, { c: 'Z' }], fill: true, stroke: true }] } } as ShapeObject;
    expect(run('union', [free, E])).toHaveLength(1);
  });
  it('열린 자유형만으로 된 도형은 병합하지 않음', async () => {
    const { mergeable } = await import('./shapeBoolean');
    const open = { ...createShape('custom', 0, 0, 100, 100), id: 'o', geometry: { paths: [{ cmds: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }], fill: true, stroke: true }] } } as ShapeObject;
    expect(mergeable(open)).toContain('열린 경로');
    expect(mergeable({ ...rect(0, 0, 10, 10), locked: true })).toBe('잠긴 개체');
  });
});

describe('K. 경계 접촉', () => {
  it('변이 맞닿은 사각형: 통합은 하나의 사각형, 교차는 빈 결과, 조각은 미세 조각 없이 두 개', () => {
    const A = rect(0, 0, 100, 100), B = rect(100, 0, 100, 100);
    const u = run('union', [A, B]);
    close(area(u), 20000);
    expect(u[0].geometry.paths[0].cmds.filter((c) => c.c === 'M')).toHaveLength(1);
    expect(run('intersect', [A, B])).toEqual([]);
    expect(run('fragment', [A, B]).map((x) => Math.round(shapeArea(x)))).toEqual([10000, 10000]);
  });
  it('한 점에서 닿은 원: 교차는 빈 결과, 조각은 두 개', () => {
    const A = circle(0, 0), B = circle(100, 0);
    expect(run('intersect', [A, B])).toEqual([]);
    expect(run('fragment', [A, B])).toHaveLength(2);
  });
});

describe('점 편집용 변환', () => {
  it('원 프리셋 → 베지어 자유형 (같은 상자 안 0..1)', () => {
    const g = presetToGeometry(circle(0, 0, 100))!;
    const cmds = g.paths[0].cmds;
    expect(cmds.filter((c) => c.c === 'C').length).toBeGreaterThanOrEqual(4);
    const pts = cmds.filter((c) => c.c !== 'Z') as { x: number; y: number }[];
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0, 3);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(1, 3);
  });
});

describe('저장: PPTX 자유형 (구멍 유지)', () => {
  it('도넛 → custGeom 한 경로에 하위 경로 2개(moveTo), LibreOffice로 그리면 구멍이 비어 있음', async () => {
    const { spawnSync, execFileSync } = await import('node:child_process');
    const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
    const JSZip = (await import('jszip')).default;
    const { produce } = await import('immer');
    const { createPresentation } = await import('../../core/document/factory');
    const { exportPptxBytes } = await import('../../services/export/pptxExport');
    const m = run('subtract', [circle(300, 100, 400), circle(400, 200, 200)])[0];
    const doc = produce(createPresentation('도넛'), (d) => {
      d.slides[0].objects = [{ ...createShape('custom', m.x, m.y, m.width, m.height), id: 'donut', geometry: m.geometry, fill: { type: 'solid', color: '#3B82F6' }, stroke: null } as ShapeObject];
    });
    const { bytes } = await exportPptxBytes(doc);
    const xml = await (await JSZip.loadAsync(bytes)).file('ppt/slides/slide1.xml')!.async('string');
    const path = xml.match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/)![0];
    expect((path.match(/<a:moveTo>/g) ?? []).length).toBe(2);
    expect((path.match(/<a:path /g) ?? []).length).toBe(1);
    if (spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status !== 0) return; // CI에는 LibreOffice 없음
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/merge-donut.pptx', bytes);
    execFileSync('soffice', [`-env:UserInstallation=file://${process.cwd()}/test-output/lo-profile-${process.pid}-${Math.random().toString(36).slice(2)}`, '--headless', '--convert-to', 'pdf', '--outdir', 'test-output', 'test-output/merge-donut.pptx'], { stdio: 'ignore', timeout: 120000 });
    execFileSync('pdftoppm', ['-png', '-r', '24', '-singlefile', 'test-output/merge-donut.pdf', 'test-output/merge-donut']);
    // PNG 디코드 없이 확인: pdftoppm -gray PPM으로 다시 뽑아 픽셀 값 읽기
    execFileSync('pdftoppm', ['-r', '24', '-singlefile', 'test-output/merge-donut.pdf', 'test-output/merge-donut']);
    const ppm = readFileSync('test-output/merge-donut.ppm');
    const header = ppm.toString('latin1', 0, 30).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/)!;
    const w = +header[1], off = header[0].length;
    const px = (sx: number, sy: number) => {
      // 슬라이드 1280×720 px → 24dpi (13.333in × 7.5in) = 320×180
      const x = Math.round((sx / 1280) * w), y = Math.round((sy / 720) * (w * 720 / 1280));
      const i = off + (y * w + x) * 3;
      return [ppm[i], ppm[i + 1], ppm[i + 2]];
    };
    const hole = px(500, 300), ringPx = px(330, 300);
    expect(hole.every((v) => v > 230)).toBe(true); // 흰 배경 (구멍)
    expect(ringPx[2]).toBeGreaterThan(200); // 파란 고리
    expect(ringPx[0]).toBeLessThan(120);
  });
});
